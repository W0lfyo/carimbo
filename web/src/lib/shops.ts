/**
 * Demo shops, by country. All fictional. Each one signs with one of the five shop
 * accounts on Stellar Testnet (`role`); the shops of a country share them.
 */
import type { ShopRole } from './stellar';
import type { Shop } from './types';

export interface CatalogShop extends Shop {
  role: ShopRole;
  sample: { item: string; amount: string }; // first line of the till, in local currency
}

const S = (id: string, name: string, area: string, domain: string, country: string, role: ShopRole, item: string, amount: string): CatalogShop => ({
  id,
  name,
  area,
  domain,
  country,
  role,
  sample: { item, amount },
});

export const SHOP_CATALOG: CatalogShop[] = [
  S('loja-azul', 'Loja Azul', 'Chiado, Lisbon', 'lojaazul.pt', 'PT', 'lojaAzul', 'Leather bag', '400.00'),
  S('casa-verde', 'Casa Verde', 'Príncipe Real, Lisbon', 'casaverde.pt', 'PT', 'casaVerde', 'Ceramics set', '200.00'),
  S('fio-de-alfama', 'Fio de Alfama', 'Alfama, Lisbon', 'fiodealfama.pt', 'PT', 'fioAlfama', 'Linen tablecloth', '180.00'),
  S('ourivesaria-lume', 'Ourivesaria Lume', 'Baixa, Lisbon', 'ourivesarialume.pt', 'PT', 'lume', 'Gold filigree earrings', '650.00'),
  S('sapataria-gaivota', 'Sapataria Gaivota', 'Campo de Ourique, Lisbon', 'sapatariagaivota.pt', 'PT', 'gaivota', 'Leather loafers', '240.00'),
  S('es-casa-alba', 'Casa Alba', 'Malasaña, Madrid', 'casaalba.es', 'ES', 'lojaAzul', 'Leather boots', '180.00'),
  S('es-tienda-sol', 'Tienda del Sol', 'El Born, Barcelona', 'tiendadelsol.es', 'ES', 'casaVerde', 'Ceramic plates', '120.00'),
  S('fr-maison-bleue', 'Maison Bleue', 'Le Marais, Paris', 'maisonbleue.fr', 'FR', 'lojaAzul', 'Silk scarf', '220.00'),
  S('fr-atelier-riviere', 'Atelier Rivière', 'Saint-Germain, Paris', 'atelierriviere.fr', 'FR', 'casaVerde', 'Leather wallet', '160.00'),
  S('it-bottega-verde', 'Bottega Verde', 'Brera, Milan', 'bottegaverde.it', 'IT', 'lojaAzul', 'Leather handbag', '350.00'),
  S('it-pelletteria-sole', 'Pelletteria Sole', 'Trastevere, Rome', 'pelletteriasole.it', 'IT', 'casaVerde', 'Leather belt', '90.00'),
  S('de-haus-linden', 'Haus Linden', 'Mitte, Berlin', 'hauslinden.de', 'DE', 'lojaAzul', 'Wool coat', '300.00'),
  S('nl-huis-tulp', 'Huis Tulp', 'Jordaan, Amsterdam', 'huistulp.nl', 'NL', 'lojaAzul', 'Ceramic vase', '150.00'),
  S('be-maison-ardoise', 'Maison Ardoise', 'Sablon, Brussels', 'maisonardoise.be', 'BE', 'lojaAzul', 'Lace tablecloth', '200.00'),
  S('at-haus-edelweiss', 'Haus Edelweiss', 'Innere Stadt, Vienna', 'hausedelweiss.at', 'AT', 'lojaAzul', 'Crystal glasses', '250.00'),
  S('ie-clover-co', 'Clover & Co', 'Temple Bar, Dublin', 'cloverandco.ie', 'IE', 'lojaAzul', 'Aran sweater', '160.00'),
  S('gr-oliva', 'Oliva', 'Plaka, Athens', 'oliva-athens.gr', 'GR', 'lojaAzul', 'Leather sandals', '120.00'),
  S('fi-kuu-design', 'Kuu Design', 'Punavuori, Helsinki', 'kuudesign.fi', 'FI', 'lojaAzul', 'Glass bowl', '140.00'),
  S('se-ljus-studio', 'Ljus Studio', 'Södermalm, Stockholm', 'ljusstudio.se', 'SE', 'lojaAzul', 'Wool blanket', '1800.00'),
  S('dk-hygge-hus', 'Hygge Hus', 'Nørrebro, Copenhagen', 'hyggehus.dk', 'DK', 'lojaAzul', 'Design lamp', '2500.00'),
  S('ch-uhrmacher-berg', 'Uhrmacher Berg', 'Altstadt, Zurich', 'uhrmacherberg.ch', 'CH', 'lojaAzul', 'Wristwatch', '1200.00'),
  S('ch-chocolat-lac', 'Atelier du Lac', 'Vieille Ville, Geneva', 'atelierdulac.ch', 'CH', 'casaVerde', 'Leather watch strap', '350.00'),
  S('no-fjell-strikk', 'Fjell Strikk', 'Grünerløkka, Oslo', 'fjellstrikk.no', 'NO', 'lojaAzul', 'Wool sweater', '1500.00'),
  S('gb-thistle-rose', 'Thistle & Rose', 'Covent Garden, London', 'thistleandrose.co.uk', 'GB', 'lojaAzul', 'Tweed jacket', '300.00'),
  S('jp-kissa-hoshi', 'Hoshi Kogei', 'Shibuya, Tokyo', 'hoshikogei.jp', 'JP', 'lojaAzul', 'Ceramic tea set', '22000'),
  S('jp-sakura-ya', 'Sakura-ya', 'Gion, Kyoto', 'sakuraya.jp', 'JP', 'casaVerde', 'Lacquer box', '16500'),
  S('kr-hanbit', 'Hanbit Store', 'Myeongdong, Seoul', 'hanbitstore.kr', 'KR', 'lojaAzul', 'Skincare set', '80000'),
  S('sg-merlion-goods', 'Lion City Goods', 'Orchard Road, Singapore', 'lioncitygoods.sg', 'SG', 'lojaAzul', 'Silk dress', '260.00'),
  S('th-baan-silk', 'Baan Silk', 'Siam, Bangkok', 'baansilk.th', 'TH', 'lojaAzul', 'Silk scarf', '3500.00'),
  S('au-wattle-co', 'Wattle & Co', 'The Rocks, Sydney', 'wattleandco.au', 'AU', 'lojaAzul', 'Opal pendant', '450.00'),
  S('tr-lale-bazaar', 'Lale Bazaar', 'Beyoğlu, Istanbul', 'lalebazaar.tr', 'TR', 'lojaAzul', 'Hand-woven rug', '6000.00'),
];

export const catalogShop = (id: string) => SHOP_CATALOG.find((s) => s.id === id);
export const shopsOf = (country: string) => SHOP_CATALOG.filter((s) => s.country === country);
export const roleOf = (shopId: string): ShopRole => catalogShop(shopId)?.role ?? 'lojaAzul';
