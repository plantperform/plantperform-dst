// Hex values from the ICOEL design guide, for places that cannot read the CSS
// tokens in index.css: MapLibre paint properties and inline styles. Keep the
// two in step. The guide's Danish colour names are noted per entry.
export const BRAND_COLORS = {
  // Sekundære farver
  sand: '#DBCFB3',
  soil: '#85705B', // Jord
  forest: '#6B8D57', // Skov
  water: '#284E70', // Vand
  sun: '#F5D872', // Sol
  // Tertiære farver
  forestTertiary: '#5E958B',
  waterTertiary: '#4185C5',
  // Accentfarver, which the guide reserves for crops, animals and the like
  rapeseed: '#EDCC2E', // Raps
  redBrown: '#683D15', // Rødbrun
  freshGreen: '#679942', // Frisk grøn
  berry: '#7A325D', // Bær
  carrot: '#CC8234', // Gulerod
} as const

// Not in the guide: shades derived from it for contrast, and the functional
// error red that stays distinct from the brand red.
export const UI_COLORS = {
  ink: '#1F1B17',
  inkSoft: '#3B332B',
  forestDark: '#485F3A',
  freshGreenDark: '#3C5926',
  sunDark: '#BE970E',
  destructive: '#CC2B1D',
  destructiveDark: '#982016',
  sandBorder: '#E4DBC6', // Sand 75 %
} as const
