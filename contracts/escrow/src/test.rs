#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token::StellarAssetClient, vec, Address, Env};

struct Setup<'a> {
    env: Env,
    escrow: CarimboEscrowClient<'a>,
    token: token::Client<'a>,
    shop: Address,
    traveller: Address,
    platform: Address,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let issuer = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(issuer);
    let token = token::Client::new(&env, &sac.address());
    let shop = Address::generate(&env);
    StellarAssetClient::new(&env, &sac.address()).mint(&shop, &100_000_000_000);

    let customs = Address::generate(&env);
    let platform = Address::generate(&env);
    let id = env.register(CarimboEscrow, ());
    let escrow = CarimboEscrowClient::new(&env, &id);
    escrow.init(&customs, &platform, &50); // 0.5%

    Setup { traveller: Address::generate(&env), env, escrow, token, shop, platform }
}

#[test]
fn full_refund_pays_traveller_minus_fee() {
    let s = setup();
    let vat = 748_000_000i128; // 74.80 with 7 decimals
    let id = s.escrow.open(&s.shop, &s.token.address, &vat, &10_000);
    assert_eq!(s.token.balance(&s.escrow.address), vat);

    s.escrow.attach(&id, &s.traveller);
    let paid = s.escrow.release(&vec![&s.env, id]);

    let fee = vat * 50 / 10_000;
    assert_eq!(paid, vat - fee);
    assert_eq!(s.token.balance(&s.traveller), vat - fee);
    assert_eq!(s.token.balance(&s.platform), fee);
    assert_eq!(s.token.balance(&s.escrow.address), 0);
    assert_eq!(s.escrow.claim(&id).status, Status::Released);
}

#[test]
fn one_stamp_releases_a_whole_trip() {
    let s = setup();
    let a = s.escrow.open(&s.shop, &s.token.address, &748_000_000, &10_000);
    let b = s.escrow.open(&s.shop, &s.token.address, &374_000_000, &10_000);
    s.escrow.attach(&a, &s.traveller);
    s.escrow.attach(&b, &s.traveller);
    let paid = s.escrow.release(&vec![&s.env, a, b]);
    assert_eq!(paid, 1_122_000_000 - 1_122_000_000 * 50 / 10_000);
}

#[test]
fn release_needs_a_traveller() {
    let s = setup();
    let id = s.escrow.open(&s.shop, &s.token.address, &100, &10_000);
    assert_eq!(s.escrow.try_release(&vec![&s.env, id]), Err(Ok(Error::NoTraveller)));
}

#[test]
fn shop_reclaims_only_after_deadline() {
    let s = setup();
    let id = s.escrow.open(&s.shop, &s.token.address, &500, &2_000);
    let before = s.token.balance(&s.shop);
    assert_eq!(s.escrow.try_reclaim(&id), Err(Ok(Error::DeadlineNotReached)));
    s.env.ledger().set_timestamp(2_001);
    s.escrow.reclaim(&id);
    assert_eq!(s.token.balance(&s.shop), before + 500);
    assert_eq!(s.escrow.claim(&id).status, Status::Reclaimed);
}

#[test]
fn customs_cannot_release_after_deadline() {
    let s = setup();
    let id = s.escrow.open(&s.shop, &s.token.address, &500, &2_000);
    s.escrow.attach(&id, &s.traveller);
    s.env.ledger().set_timestamp(2_001);
    assert_eq!(s.escrow.try_release(&vec![&s.env, id]), Err(Ok(Error::DeadlinePassed)));
}

#[test]
fn reject_returns_vat_to_shop() {
    let s = setup();
    let before = s.token.balance(&s.shop);
    let id = s.escrow.open(&s.shop, &s.token.address, &500, &10_000);
    s.escrow.attach(&id, &s.traveller);
    s.escrow.reject(&vec![&s.env, id]);
    assert_eq!(s.token.balance(&s.shop), before);
    assert_eq!(s.escrow.try_release(&vec![&s.env, id]), Err(Ok(Error::NotOpen)));
}

#[test]
fn claim_cannot_be_attached_twice() {
    let s = setup();
    let id = s.escrow.open(&s.shop, &s.token.address, &500, &10_000);
    s.escrow.attach(&id, &s.traveller);
    let thief = Address::generate(&s.env);
    assert_eq!(s.escrow.try_attach(&id, &thief), Err(Ok(Error::AlreadyAttached)));
}

#[test]
fn fee_is_capped() {
    let env = Env::default();
    let id = env.register(CarimboEscrow, ());
    let escrow = CarimboEscrowClient::new(&env, &id);
    let a = Address::generate(&env);
    assert_eq!(escrow.try_init(&a, &a, &501), Err(Ok(Error::FeeTooHigh)));
}
