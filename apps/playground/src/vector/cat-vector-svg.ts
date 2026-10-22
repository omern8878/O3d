/**
 * A sitting cat drawn as layered vector art (viewBox 400 x 480).
 *
 * Every layer has an `id`, which becomes its name in the sampled point cloud.
 * Layers are listed back to front: the tail is first, so its particles form
 * the cloud's first contiguous slice and animating it touches nothing else.
 */
export const CAT_SVG = /* svg */ `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 480">
  <path id="tail" fill="#3d4370"
    d="M304 442 C336 444 372 414 378 352 C383 300 360 262 340 232
       C330 216 318 206 306 212 C296 218 300 230 310 242
       C330 268 348 302 346 348 C345 386 330 408 306 418 Z"/>

  <path id="ear-left" fill="#3d4370"
    d="M104 150 L110 46 Q112 30 126 36 L190 92 Z"/>
  <path id="ear-right" fill="#3d4370"
    d="M296 150 L290 46 Q288 30 274 36 L210 92 Z"/>

  <path id="body" fill="#3d4370"
    d="M200 70 C266 70 304 108 304 156 C304 192 286 214 264 226
       C302 262 326 330 322 394 C320 432 292 450 252 452 L148 452
       C108 450 80 432 78 394 C74 330 98 262 136 226
       C114 214 96 192 96 156 C96 108 134 70 200 70 Z"/>

  <path id="chest" fill="#6a72aa"
    d="M200 222 C238 222 262 268 260 326 C258 388 234 424 200 428
       C166 424 142 388 140 326 C138 268 162 222 200 222 Z"/>

  <ellipse id="paws" cx="160" cy="444" rx="30" ry="15" fill="#555c92"/>
  <ellipse id="paws" cx="240" cy="444" rx="30" ry="15" fill="#555c92"/>

  <path id="ear-inner-left" fill="#ff8fb8" d="M120 128 L123 60 L170 98 Z"/>
  <path id="ear-inner-right" fill="#ff8fb8" d="M280 128 L277 60 L230 98 Z"/>

  <g id="eyes" fill="#27f5a0">
    <ellipse cx="160" cy="148" rx="23" ry="19"/>
    <ellipse cx="240" cy="148" rx="23" ry="19"/>
  </g>
  <g id="pupils" fill="#04140c">
    <ellipse cx="160" cy="148" rx="5" ry="16"/>
    <ellipse cx="240" cy="148" rx="5" ry="16"/>
  </g>
  <g id="eye-glints" fill="#f4fff9">
    <circle cx="167" cy="140" r="3.6"/>
    <circle cx="247" cy="140" r="3.6"/>
  </g>

  <path id="nose" fill="#ff7aa8" d="M188 180 Q200 175 212 180 Q206 191 200 194 Q194 191 188 180 Z"/>
  <path id="mouth" fill="none" stroke="#1a1d33" stroke-width="2.4"
    d="M200 194 Q200 205 188 208 M200 194 Q200 205 212 208"/>

  <g id="whiskers" stroke="#e8ebff" stroke-width="1.6">
    <line x1="172" y1="186" x2="92" y2="170"/>
    <line x1="172" y1="192" x2="88" y2="192"/>
    <line x1="172" y1="198" x2="94" y2="214"/>
    <line x1="228" y1="186" x2="308" y2="170"/>
    <line x1="228" y1="192" x2="312" y2="192"/>
    <line x1="228" y1="198" x2="306" y2="214"/>
  </g>
</svg>
`

/** The cat's layer names, as sampled from {@link CAT_SVG}. */
export const CAT_TAIL_LAYER = 'tail'

/** Where the tail joins the body (SVG coordinates): the pivot of its sway. */
export const CAT_TAIL_PIVOT = { x: 308, y: 430 } as const

/** Friendly names shown in the HUD when a layer is picked. */
export const CAT_LAYER_LABELS: Readonly<Record<string, string>> = {
  tail: 'Tail',
  'ear-left': 'Left ear',
  'ear-right': 'Right ear',
  body: 'Body',
  chest: 'Chest',
  paws: 'Paws',
  'ear-inner-left': 'Left inner ear',
  'ear-inner-right': 'Right inner ear',
  eyes: 'Emerald eyes',
  pupils: 'Pupils',
  'eye-glints': 'Eye glints',
  nose: 'Nose',
  mouth: 'Mouth',
  whiskers: 'Whiskers',
}
