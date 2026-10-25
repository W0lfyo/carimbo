#![no_std]
//! Carimbo tax-free escrow.
//!
//! A shop locks the VAT of a tax-free sale in this contract. The traveller attaches
//! the claim to their account. When customs certifies that the goods left the
//! country, its signature releases the VAT to the traveller, minus a small platform
//! fee. If customs refuses, or the export deadline passes, the shop takes it back.

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec};

const DAY_LEDGERS: u32 = 17_280; // ~5 s per ledger
const BUMP: u32 = 120 * DAY_LEDGERS;
const BUMP_THRESHOLD: u32 = 30 * DAY_LEDGERS;
const MAX_FEE_BPS: u32 = 500; // never more than 5%

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ClaimNotFound = 3,
    NotOpen = 4,
    AlreadyAttached = 5,
    NoTraveller = 6,
    DeadlineNotReached = 7,
    DeadlinePassed = 8,
    InvalidAmount = 9,
    FeeTooHigh = 10,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Status {
    Open,
    Released,
    Rejected,
    Reclaimed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Claim {
    pub shop: Address,
    pub token: Address,
    pub amount: i128,
    pub deadline: u64,
    pub traveller: Option<Address>,
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Customs,
    Platform,
    FeeBps,
    NextId,
    Claim(u64),
}

#[contract]
pub struct CarimboEscrow;

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP);
}

fn load(env: &Env, id: u64) -> Result<Claim, Error> {
    let key = Key::Claim(id);
    let claim: Claim = env.storage().persistent().get(&key).ok_or(Error::ClaimNotFound)?;
    env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP);
    Ok(claim)
}

fn save(env: &Env, id: u64, claim: &Claim) {
    let key = Key::Claim(id);
    env.storage().persistent().set(&key, claim);
    env.storage().persistent().extend_ttl(&key, BUMP_THRESHOLD, BUMP);
}

fn customs(env: &Env) -> Result<Address, Error> {
    env.storage().instance().get(&Key::Customs).ok_or(Error::NotInitialized)
}

#[contractimpl]
impl CarimboEscrow {
    /// One-time setup: the customs authority that certifies exports, the platform
    /// account that receives the fee, and the fee in basis points (50 = 0.5%).
    pub fn init(env: Env, customs: Address, platform: Address, fee_bps: u32) -> Result<(), Error> {
        if env.storage().instance().has(&Key::Customs) {
            return Err(Error::AlreadyInitialized);
        }
        if fee_bps > MAX_FEE_BPS {
            return Err(Error::FeeTooHigh);
        }
        env.storage().instance().set(&Key::Customs, &customs);
        env.storage().instance().set(&Key::Platform, &platform);
        env.storage().instance().set(&Key::FeeBps, &fee_bps);
        env.storage().instance().set(&Key::NextId, &1u64);
        bump_instance(&env);
        Ok(())
    }

    /// The shop locks `amount` of `token` (the VAT of a sale) until `deadline` (unix seconds).
    pub fn open(env: Env, shop: Address, token: Address, amount: i128, deadline: u64) -> Result<u64, Error> {
        shop.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::DeadlinePassed);
        }
        customs(&env)?;
        token::Client::new(&env, &token).transfer(&shop, &env.current_contract_address(), &amount);

        let id: u64 = env.storage().instance().get(&Key::NextId).unwrap_or(1);
        env.storage().instance().set(&Key::NextId, &(id + 1));
        bump_instance(&env);
        save(&env, id, &Claim { shop, token, amount, deadline, traveller: None, status: Status::Open });
        env.events().publish((symbol_short!("open"), id), amount);
        Ok(id)
    }

    /// The traveller adds the claim to their account (after scanning the shop QR).
    pub fn attach(env: Env, id: u64, traveller: Address) -> Result<(), Error> {
        traveller.require_auth();
        let mut claim = load(&env, id)?;
        if claim.status != Status::Open {
            return Err(Error::NotOpen);
        }
        if claim.traveller.is_some() {
            return Err(Error::AlreadyAttached);
        }
        claim.traveller = Some(traveller.clone());
        save(&env, id, &claim);
        env.events().publish((symbol_short!("attach"), id), traveller);
        Ok(())
    }

    /// Customs certifies the export of every claim in `ids`: each one pays the traveller.
    /// Returns the total amount sent to travellers.
    pub fn release(env: Env, ids: Vec<u64>) -> Result<i128, Error> {
        customs(&env)?.require_auth();
        let platform: Address = env.storage().instance().get(&Key::Platform).ok_or(Error::NotInitialized)?;
        let fee_bps: u32 = env.storage().instance().get(&Key::FeeBps).unwrap_or(0);
        let now = env.ledger().timestamp();
        let mut paid: i128 = 0;
        for id in ids.iter() {
            let mut claim = load(&env, id)?;
            if claim.status != Status::Open {
                return Err(Error::NotOpen);
            }
            if now > claim.deadline {
                return Err(Error::DeadlinePassed);
            }
            let traveller = claim.traveller.clone().ok_or(Error::NoTraveller)?;
            let fee = claim.amount * fee_bps as i128 / 10_000;
            let net = claim.amount - fee;
            let tok = token::Client::new(&env, &claim.token);
            tok.transfer(&env.current_contract_address(), &traveller, &net);
            if fee > 0 {
                tok.transfer(&env.current_contract_address(), &platform, &fee);
            }
            claim.status = Status::Released;
            save(&env, id, &claim);
            env.events().publish((symbol_short!("release"), id), net);
            paid += net;
        }
        bump_instance(&env);
        Ok(paid)
    }

    /// Customs refuses the export: the VAT goes back to each shop.
    pub fn reject(env: Env, ids: Vec<u64>) -> Result<(), Error> {
        customs(&env)?.require_auth();
        for id in ids.iter() {
            let mut claim = load(&env, id)?;
            if claim.status != Status::Open {
                return Err(Error::NotOpen);
            }
            token::Client::new(&env, &claim.token).transfer(&env.current_contract_address(), &claim.shop, &claim.amount);
            claim.status = Status::Rejected;
            save(&env, id, &claim);
            env.events().publish((symbol_short!("reject"), id), claim.amount);
        }
        Ok(())
    }

    /// After the export deadline, the shop takes back a claim that customs never certified.
    pub fn reclaim(env: Env, id: u64) -> Result<(), Error> {
        let mut claim = load(&env, id)?;
        claim.shop.require_auth();
        if claim.status != Status::Open {
            return Err(Error::NotOpen);
        }
        if env.ledger().timestamp() <= claim.deadline {
            return Err(Error::DeadlineNotReached);
        }
        token::Client::new(&env, &claim.token).transfer(&env.current_contract_address(), &claim.shop, &claim.amount);
        claim.status = Status::Reclaimed;
        save(&env, id, &claim);
        env.events().publish((symbol_short!("reclaim"), id), claim.amount);
        Ok(())
    }

    pub fn claim(env: Env, id: u64) -> Result<Claim, Error> {
        load(&env, id)
    }

    pub fn fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&Key::FeeBps).unwrap_or(0)
    }
}

#[cfg(test)]
mod test;
