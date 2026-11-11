/** Simple line illustrations for the demo catalog (no external images). */
const ART = {
  teapot: (
    <>
      <path d="M30 52c0-12 9-20 22-20s22 8 22 20v6c0 8-7 14-15 14H45c-8 0-15-6-15-14z" />
      <path d="M74 46c8-2 14 3 12 10-1 5-6 8-12 8M30 48l-10-8c-3-2-6 1-5 4l7 12c2 3 5 5 8 5" />
      <path d="M44 32c0-4 4-7 8-7s8 3 8 7M52 25v-4" />
      <path d="M24 80h56" />
    </>
  ),
  runner: (
    <>
      <path d="M22 30h56v40H22z" />
      <path d="M22 40h56M22 60h56M32 30v40M68 30v40" />
      <path d="M22 70l-3 8M30 70l-2 8M70 70l2 8M78 70l3 8" />
    </>
  ),
  stand: (
    <>
      <path d="M50 76V34" />
      <path d="M36 34c0-8 6-14 14-14s14 6 14 14" />
      <path d="M32 80h36c2 0 3-2 2-4l-3-4H33l-3 4c-1 2 0 4 2 4z" />
      <path d="M34 34h6v14h-6zM60 34h6v14h-6z" />
    </>
  ),
  candle: (
    <>
      <path d="M24 46h16v32H24zM42 40h16v38H42zM60 50h16v28H60z" />
      <path d="M32 46v-6M50 40v-6M68 50v-6" />
      <path d="M32 34c-2 2-2 4 0 5 2-1 2-3 0-5zM50 28c-2 2-2 4 0 5 2-1 2-3 0-5zM68 38c-2 2-2 4 0 5 2-1 2-3 0-5z" />
    </>
  ),
  dinnerware: (
    <>
      <ellipse cx="50" cy="56" rx="32" ry="12" />
      <ellipse cx="50" cy="56" rx="20" ry="7" />
      <path d="M30 40h40l-4 12H34z" />
      <path d="M38 30h24v10H38z" />
    </>
  ),
  pendant: (
    <>
      <path d="M26 22c8 14 16 20 24 20s16-6 24-20" />
      <path d="M50 42v6" />
      <path d="M50 48c-10 6-14 14-12 22 4 6 8 8 12 10 4-2 8-4 12-10 2-8-2-16-12-22z" />
      <path d="M50 52v26M50 62l-6-4M50 70l7-5" />
    </>
  )
}

const TINTS = { teapot: '#e9f1fb', runner: '#f3efe6', stand: '#f1ebe4', candle: '#fbf1e4', dinnerware: '#e6eef9', pendant: '#eef0f3' }

export function ProductArt({ image }) {
  return (
    <div className="product-art" style={{ background: TINTS[image] || '#eef2f6' }}>
      <svg viewBox="0 0 100 100" fill="none" stroke="#003087" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ART[image] || ART.teapot}
      </svg>
    </div>
  )
}
