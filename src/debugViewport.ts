// Live viewport numbers on screen, for debugging layout in the installed
// iPhone app, where there are no dev tools. On with ?debug-viewport in the URL
// (add it to the home screen from that URL to get it in the installed app).
const probe = document.createElement('div')
probe.style.cssText =
  'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)'
const box = document.createElement('pre')
box.style.cssText =
  'position:fixed;left:50%;top:45%;transform:translateX(-50%);z-index:9999;margin:0;padding:6px 8px;font:11px/1.35 monospace;background:#000c;color:#0f0;border:1px solid #0f0;pointer-events:none;white-space:pre'
const units = ['vh', 'lvh', 'svh', 'dvh'].map((u) => {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;visibility:hidden;top:0;height:100${u}`
  document.body.append(el)
  return [u, el] as const
})
document.body.append(probe, box)
const update = () => {
  const cs = getComputedStyle(probe)
  const root = document.getElementById('root')?.firstElementChild?.getBoundingClientRect()
  const header = document.querySelector('header')?.getBoundingClientRect()
  const vv = window.visualViewport
  box.textContent = [
    `standalone ${matchMedia('(display-mode: standalone)').matches} ${(navigator as { standalone?: boolean }).standalone}`,
    `screen ${screen.width}x${screen.height}`,
    `inner ${innerWidth}x${innerHeight} outer ${outerHeight}`,
    `docEl client ${document.documentElement.clientHeight}`,
    `vv h ${vv?.height.toFixed(1)} top ${vv?.offsetTop.toFixed(1)} pageTop ${vv?.pageTop.toFixed(1)}`,
    `scrollY ${scrollY}`,
    `safe t${cs.paddingTop} b${cs.paddingBottom} l${cs.paddingLeft} r${cs.paddingRight}`,
    `root top ${root?.top.toFixed(1)} bottom ${root?.bottom.toFixed(1)}`,
    units.map(([u, el]) => `${u} ${el.getBoundingClientRect().height.toFixed(0)}`).join(' '),
    `header top ${header?.top.toFixed(1)} h ${header?.height.toFixed(1)}`,
  ].join('\n')
}
update()
setInterval(update, 500)
