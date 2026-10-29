// Landscape paper, normal horizontal tables. Keep natural browser pagination;
// no rotation, dimension swapping, absolute positioning or row enlargement.
export const payrollLandscapePrintCss = `
@page{size:A4 landscape;margin:7mm}
html,body,.team-report-all,.team-report-content,.team,table{width:100%;max-width:none;min-width:0;height:auto;min-height:0}
table{border-collapse:collapse}
@media screen{body{width:283mm}}
`

export function finishPayrollPrint(popup) {
  return Promise.resolve(popup.document.fonts?.ready).then(() => {
    popup.focus()
    popup.print()
  })
}
