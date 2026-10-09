let active: { owner: object; stop: () => void } | undefined;
export function claimMusicAudio(owner: object, stop: () => void) {
  if (active?.owner !== owner) active?.stop();
  active = { owner, stop };
}
export function releaseMusicAudio(owner: object) {
  if (active?.owner === owner) active = undefined;
}
