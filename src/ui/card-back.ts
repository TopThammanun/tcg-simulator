// The back of a Pokémon card, loaded at run time like the card images. pokemontcg.io serves it as the
// picture for any image it doesn't have (with HTTP 404, so the console shows one failed request; the
// browser still draws it). If it stops loading, the drawn back in CardBack.svelte / FxLayer.svelte shows.
export const CARD_BACK = 'https://images.pokemontcg.io/cardback.png';
