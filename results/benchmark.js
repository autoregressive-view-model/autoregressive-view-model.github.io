/* Sort selected report metrics; a second click restores the authored row order. */
(function(){
  'use strict';
  const table=document.querySelector('[data-benchmark-summary-table]');if(!table)return;
  const body=table.tBodies[0],rows=[...body.rows],buttons=[...table.querySelectorAll('[data-sort-metric]')];let active=null;
  const defaultIndex=row=>Number(row.dataset.defaultOrder);
  for(const button of buttons){
    const column=Number(button.dataset.sortMetric)+1,cells=rows.map(row=>row.cells[column]);
    const measured=cells.filter(cell=>cell.dataset.value!==undefined&&Number.isFinite(Number(cell.dataset.value)));
    if(!measured.length)continue;
    const values=measured.map(cell=>Number(cell.dataset.value)),best=button.dataset.direction==='high'?Math.max(...values):Math.min(...values);
    for(const cell of measured)cell.classList.toggle('benchmark-best',Number(cell.dataset.value)===best);
  }

  for(const button of buttons)button.addEventListener('click',()=>{
    const column=Number(button.dataset.sortMetric),reset=active===button;active=reset?null:button;
    buttons.forEach(control=>{const sorted=control===active;control.setAttribute('aria-pressed',String(sorted));control.closest('th').setAttribute('aria-sort',sorted?(control.dataset.direction==='high'?'descending':'ascending'):'none');});
    const ordered=[...rows];
    ordered.sort((a,b)=>{
      if(reset)return defaultIndex(a)-defaultIndex(b);
      const first=a.cells[column+1].dataset.value,second=b.cells[column+1].dataset.value;
      if(first===undefined)return second===undefined?defaultIndex(a)-defaultIndex(b):1;
      if(second===undefined)return -1;
      const difference=button.dataset.direction==='high'?Number(second)-Number(first):Number(first)-Number(second);
      return difference||defaultIndex(a)-defaultIndex(b);
    });
    ordered.forEach(row=>body.append(row));
  });
})();
