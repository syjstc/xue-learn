import {designTokens} from "../../../shared/design-tokens.js";

// Use the same light stage as XueLearn's classroom. Resolve from the shared
// contract at bundle time: no copied palette or dependence on the OS theme.
const palette=designTokens.themes.light;
const theater=designTokens.components.scenarioTheater;
const card=designTokens.components.card;
const resolve=(key:string)=>palette[key as keyof typeof palette];
export const tint=(hex:string,opacity:number)=>`${hex}${Math.round(Math.max(0,Math.min(1,opacity))*255).toString(16).padStart(2,'0')}`;
const blend=(a:string,b:string,amount:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-amount)+parseInt(b.slice(i,i+2),16)*amount).toString(16).padStart(2,'0')).join('');
export const orbShade=(accent:string)=>blend(accent,palette.ink,.55);

// Scale component geometry from UI pixels to the fixed 1080p stage. Text and
// spatial teaching geometry keep their authored dimensions, including on seek.
const unit=2;
const shadow=card.shadow.light;
export const THEME={
  stage:resolve(theater.stageBackground),
  surface:resolve(theater.panelBackground),
  surfaceStrong:resolve(theater.panelStrongBackground),
  inset:palette.surfaceInset,
  elevated:palette.surfaceContainerHigh,
  ink:resolve(theater.foreground),
  muted:resolve(theater.muted),
  tertiary:palette.tertiary,
  border:resolve(theater.panelBorder),
  borderLight:resolve(card.borderColor),
  accent:resolve(theater.accent),
  accentText:palette.primaryDark,
  accentSoft:resolve(theater.accentSoft),
  compare:resolve(theater.neutral),
  // Larger data graphics use info/warning; small colored labels get an ink mix.
  compareText:blend(resolve(theater.neutral),palette.ink,.28),
  caution:resolve(theater.risk),
  cautionText:blend(resolve(theater.risk),palette.ink,.42),
  positive:resolve(theater.positive),
  narrationBackground:resolve(theater.narrationBackground),
  narrationForeground:resolve(theater.narrationForeground),
  inverse:palette.inverse,
  progressTrack:palette.progressTrack,
  progressFill:palette.progressFill,
  radius:card.radius*unit,
  radiusHud:theater.radiusHud*unit,
  radiusDialogue:theater.radiusDialogue*unit,
  borderWidth:card.borderWidth,
  shadow:`${shadow.offsetX*unit}px ${shadow.offsetY*unit}px ${shadow.blur*unit}px ${tint(shadow.color,shadow.opacity)}`,
  wallFront:blend(palette.surfaceInset,palette.tertiary,.45),
  wallSide:blend(palette.surfaceContainerHigh,palette.muted,.38),
  wallTop:palette.surfaceInset,
  wallLine:palette.tertiary,
};

export const readableAccent=(color:string)=>color===THEME.accent?THEME.accentText:color===THEME.compare?THEME.compareText:color===THEME.caution?THEME.cautionText:color;
