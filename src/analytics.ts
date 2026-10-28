// Anonymous usage counts for the beta (GoatCounter): page visits, plus three events – a lesson started, a lesson
// passed, the sound failing – each with at most a lesson id. No cookies or browser storage on GoatCounter's side, no
// IP addresses kept, nothing about the player. Off until GOATCOUNTER is set, never in development, and every player
// can switch it off in Settings.

/** The site code from goatcounter.com (e.g. `mochimidi` for https://mochimidi.goatcounter.com); '' = counting off. */
export const GOATCOUNTER = ''
const OPT_OUT = 'pianoapp.v1.noStats'

export type StatEvent = 'lesson-started' | 'lesson-passed' | 'sound-failed'

type Counter = { count: (o: { path: string; title?: string; event?: boolean }) => void }
const queue: string[] = [] // events made before the script arrived
let loaded = false

export function statsAllowed() {
  try { return localStorage.getItem(OPT_OUT) !== '1' } catch { return true }
}
export function setStatsAllowed(on: boolean) {
  try { if (on) localStorage.removeItem(OPT_OUT); else localStorage.setItem(OPT_OUT, '1') } catch { /* blocked storage: stays on */ }
}
const active = () => !!GOATCOUNTER && import.meta.env.PROD && statsAllowed()

/** Loads GoatCounter once (it counts the page visit itself), then sends anything queued meanwhile. */
export function initStats() {
  if (loaded || !active()) return
  loaded = true
  const s = document.createElement('script')
  s.async = true
  s.src = 'https://gc.zgo.at/count.js'
  s.dataset.goatcounter = `https://${GOATCOUNTER}.goatcounter.com/count`
  s.onload = () => { for (const path of queue.splice(0)) send(path) }
  document.head.appendChild(s)
}

const sent = new Set<string>()
/** Count an event; `once` keeps a repeating one (a failing sound) to one count per visit. */
export function track(event: StatEvent, detail?: string, once = false) {
  if (!active()) return
  const path = detail ? `${event}/${detail}` : event
  if (once) { if (sent.has(path)) return; sent.add(path) }
  if ((window as Window & { goatcounter?: Counter }).goatcounter?.count) send(path)
  else queue.push(path)
}
function send(path: string) {
  (window as Window & { goatcounter?: Counter }).goatcounter?.count({ path, title: path, event: true })
}
