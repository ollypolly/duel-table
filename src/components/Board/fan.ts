// The pinned hand's size, which the camera needs as well as the fan.
export const SINK = 0.1 // of a card's height, below the edge

// Card height for a board this size: small on a phone, where it's only there
// to tap.
export const fanCardHeight = (board: { w: number; h: number }) => (board.w < 640 ? 84 : Math.round(Math.min(180, Math.max(120, board.h * 0.2))))
// How much of the board's bottom the fan covers.
export const fanHeight = (cardH: number) => Math.round(cardH * (1 - SINK))
