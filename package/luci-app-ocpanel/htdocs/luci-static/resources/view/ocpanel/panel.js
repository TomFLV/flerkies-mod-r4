'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callStatus = rpc.declare({ object: 'ocpanel', method: 'status' });
var callSetF   = rpc.declare({ object: 'ocpanel', method: 'setfreq', params: [ 'mhz' ] });
var callSetV   = rpc.declare({ object: 'ocpanel', method: 'setvolt', params: [ 'mv' ] });
var callBStart = rpc.declare({ object: 'ocpanel', method: 'bench_start', params: [ 'secs', 'cores' ] });
var callBStat  = rpc.declare({ object: 'ocpanel', method: 'bench_status' });
var callBHist  = rpc.declare({ object: 'ocpanel', method: 'bench_history' });
var callThrottle = rpc.declare({ object: 'ocpanel', method: 'throttle', params: [ 'on' ] });
var callStock  = rpc.declare({ object: 'ocpanel', method: 'stock' });

var TEMPMAX=90, THROTTLE_C=80;
function drawSpark(cv, data){
	if(!cv) return; var ctx=cv.getContext('2d'); var w=cv.width, h=cv.height;
	ctx.clearRect(0,0,w,h);
	// throttle threshold line (80C) in red
	var yT=h-((THROTTLE_C-20)/(TEMPMAX-20))*h;
	ctx.strokeStyle='rgba(211,51,51,0.5)'; ctx.setLineDash([4,4]); ctx.beginPath(); ctx.moveTo(0,yT); ctx.lineTo(w,yT); ctx.stroke(); ctx.setLineDash([]);
	if(data.length<2) return;
	var N=120;
	ctx.lineWidth=2; ctx.beginPath();
	for(var i=0;i<data.length;i++){
		var x=w*i/(N-1); var y=h-((data[i]-20)/(TEMPMAX-20))*h; if(y<1)y=1; if(y>h-1)y=h-1;
		if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);
	}
	var last=data[data.length-1];
	ctx.strokeStyle = last>=THROTTLE_C ? '#d33' : (last>=65?'#e67e22':'#27ae60'); ctx.stroke();
}

function fmtDur(s){ s=parseInt(s)||0; if(s>=3600)return (s/3600)+' hr'; if(s>=60)return (s/60)+' min'; return s+' s'; }

// like ui.addNotification but auto-dismisses after ~18s
function autoNotify(child, type){
	var n = ui.addNotification(null, child, type||'info');
	if (n) window.setTimeout(function(){ try { if (n && n.parentNode) n.parentNode.removeChild(n); } catch(e){} }, 18000);
	return n;
}

function resultText(r){
	var pass=(r.stable==='PASS');
	var verd = pass ? '✓ PASS' : (r.stable==='ABORTED' ? '✗ ABORTED: '+(r.abort||'?') : '✗ FAIL');
	return '  SCORE        '+(pass?((r.score||0)+' pts    (CoreMark '+Math.round(r.coremark||0)+')'):'—')+'\n'+
		'  Cores        '+(r.cores||4)+'\n'+
		'  Speed        '+((r.speed_mhz||0)/1000).toFixed(2)+' GHz\n'+
		'  Voltage      '+((r.voltage_mv||0)/1000).toFixed(3)+' V\n'+
		'  Temp         '+(r.temp_avg||0)+' °C avg  ·  '+(r.temp_peak||0)+' °C peak\n'+
		'  Memory       '+(r.mem_mb||0)+' MB  ·  '+((r.ram_mbps||0)>0?(r.ram_mbps+' MB/s'):'n/a')+'  ·  '+(r.errors||0)+' errors\n'+
		'  Duration     '+fmtDur(r.elapsed_s||r.duration_s)+(r.elapsed_s&&r.elapsed_s<r.duration_s?' (of '+fmtDur(r.duration_s)+')':'')+'\n'+
		'  Stability    '+verd;
}

return view.extend({
	rd:{}, coreEls:[], prevCores:null, fInput:null, vInput:null, durSel:null, benchCard:null, benchBtn:null, histBox:null,
	tempCanvas:null, tempHist:[], thrBtn:null, thrOn:false, lastTemp:0, lastThrottle:0,

	render: function() {
		var self = this;
		function ro(key,label,unit){
			var v=E('span',{'style':'font:700 24px/1 monospace'},'—');
			self.rd[key]=v;
			return E('div',{'style':'padding:8px 18px;min-width:94px'},[v,E('div',{'style':'color:#888;font-size:11px;margin-top:3px'},label+(unit?' ('+unit+')':''))]);
		}

		// per-core load cells
		var coreRow=E('div',{'style':'display:flex;gap:10px;flex-wrap:wrap;margin-top:6px'});
		for(var i=0;i<8;i++){ // up to 8; we hide unused
			var pct=E('span',{'style':'font:700 15px/1 monospace'},'—');
			var bar=E('div',{'style':'height:6px;background:#2d7dd2;width:0%;border-radius:3px;transition:width .3s'});
			var cell=E('div',{'style':'min-width:80px;display:none'},[
				E('div',{'style':'color:#888;font-size:11px'},'Core '+i),pct,
				E('div',{'style':'background:rgba(128,128,128,.25);border-radius:3px;margin-top:3px'},bar)
			]);
			this.coreEls.push({cell:cell,pct:pct,bar:bar});
			coreRow.appendChild(cell);
		}

		this.fInput = E('input',{'type':'number','class':'cbi-input-text','style':'width:100px','min':'600','max':'2500','placeholder':'MHz'});
		this.vInput = E('input',{'type':'number','class':'cbi-input-text','style':'width:100px','min':'600','max':'1100','placeholder':'mV'});
		this.durSel = E('select',{'class':'cbi-input-select'},[
			E('option',{'value':'30'},'30 s'),E('option',{'value':'60','selected':'selected'},'1 min'),
			E('option',{'value':'300'},'5 min'),E('option',{'value':'900'},'15 min'),
			E('option',{'value':'1800'},'30 min'),E('option',{'value':'3600'},'1 hour')
		]);
		this.coreSel = E('select',{'class':'cbi-input-select'},[
			E('option',{'value':'1'},'1 core'),E('option',{'value':'2'},'2 cores'),
			E('option',{'value':'3'},'3 cores'),E('option',{'value':'4','selected':'selected'},'4 cores')
		]);
		this.benchCard = E('pre',{'style':'margin:0;font:13px/1.5 monospace;white-space:pre;background:var(--background-color-medium,#f4f4f4);border-radius:8px;padding:12px 14px;min-height:40px'},'No benchmark run yet.');
		this.histBox = E('div',{'style':'overflow:auto'},E('em','Loading…'));
		this.tempCanvas = E('canvas',{'width':560,'height':90,'style':'width:100%;height:90px;display:block;margin-top:6px'});
		this.thrBtn = null;  // throttle is an always-on safety; shown as status, not a toggle

		var applyF = E('button',{'class':'btn cbi-button cbi-button-apply','click':ui.createHandlerFn(this,function(){
			var m=parseInt(this.fInput.value); if(!m)return;
			return callSetF(m).then(function(r){ autoNotify(E('p', r&&r.ok?('Speed → '+(m/1000).toFixed(2)+' GHz (volts auto-set '+((r.vset||0)/1000).toFixed(3)+' V)'):('Failed: '+(r&&r.err||'no module'))), r&&r.ok?'info':'error'); });
		})},'Set speed');
		var applyV = E('button',{'class':'btn cbi-button cbi-button-apply','click':ui.createHandlerFn(this,function(){
			var mv=parseInt(this.vInput.value); if(!mv)return;
			return callSetV(mv).then(function(r){ autoNotify(E('p', r&&r.ok?('Voltage → '+(mv/1000).toFixed(3)+' V'):('Failed: '+(r&&r.err||'no module'))), r&&r.ok?'info':'error'); });
		})},'Set voltage');

		var stockBtn = E('button',{'class':'btn cbi-button cbi-button-reset','click':ui.createHandlerFn(this,function(){
			return callStock().then(L.bind(function(r){ this.fInput.value=''; this.vInput.value=''; autoNotify(E('p','Reset to stock clock — 1.50 GHz'),'info'); },this));
		})},'↺ Stock defaults (1.5 GHz)');

		this.benchBtn = E('button',{'class':'btn cbi-button cbi-button-action','click':ui.createHandlerFn(this,function(){
			var secs=parseInt(this.durSel.value)||60;
			var cores=parseInt(this.coreSel.value)||4;
			this.benchBtn.disabled=true;
			this.benchCard.textContent='starting '+fmtDur(secs)+' CPU+RAM test on '+cores+' core(s)…';
			return callBStart(secs, cores).then(L.bind(function(r){
				if(!r||!r.ok){ this.benchCard.textContent='could not start: '+((r&&r.err)||'?'); this.benchBtn.disabled=false; return; }
				this.pollBench();
			},this));
		})},'Run benchmark');

		var node=E('div',{},[
			E('h2','CPU Control — Flerkies (MT7988A · Cortex-A73 ×4)'),
			E('div',{'class':'cbi-section','style':'padding:6px 2px'},[
				E('div',{'style':'display:flex;flex-wrap:wrap;align-items:center'},[
					ro('speed','Speed','GHz'),ro('volt','Voltage','V'),ro('temp','CPU','°C'),
					ro('nvme','NVMe','°C'),ro('load','Load','1m'),ro('gov','Governor','')
				]),
				E('div',{'style':'display:flex;align-items:center;gap:10px;margin:6px 0 2px'},[
					E('strong',{'style':'color:#2d7dd2'},'🛡 Thermal safety (always on):'), this.rd.thrStat=E('span',{'style':'font-weight:700'},'—')
				]),
				E('div',{'style':'color:#888;font-size:11px;margin:6px 0 2px'},'CPU temperature (dashed = 80°C throttle line)'),
				this.tempCanvas,
				E('div',{'style':'color:#888;font-size:11px;margin:8px 0 2px'},'Per-core load'),
				coreRow,
				E('div',{'id':'ocp-warn','style':'color:#d33;font-size:12px;margin-top:4px'},'')
			]),
			E('div',{'class':'cbi-section'},[
				E('h3',{'style':'margin:0 0 8px'},'Manual control'),
				E('div',{'style':'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px'},[E('strong',{'style':'min-width:70px'},'Speed:'),this.fInput,E('span',{'style':'color:#888'},'MHz'),applyF]),
				E('div',{'style':'display:flex;gap:8px;align-items:center;flex-wrap:wrap'},[E('strong',{'style':'min-width:70px'},'Voltage:'),this.vInput,E('span',{'style':'color:#888'},'mV'),applyV]),
				E('div',{'style':'margin-top:10px'},[ stockBtn ]),
				E('div',{'style':'color:#e67e22;font-size:12px;margin-top:6px'},'Setting a speed auto-applies a safe voltage. Max 2500 MHz / 1100 mV.')
			]),
			E('div',{'class':'cbi-section'},[
				E('h3',{'style':'margin:0 0 8px'},'Benchmark'),
				E('div',{'style':'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px'},[E('strong',{'style':'min-width:70px'},'Duration:'),this.durSel,E('strong',{},'Cores:'),this.coreSel,this.benchBtn]),
				this.benchCard
			]),
			E('div',{'class':'cbi-section'},[
				E('h3',{'style':'margin:0 0 8px'},'Benchmark history'),
				this.histBox
			])
		]);

		poll.add(function(){
			return callStatus().then(function(s){
				if(!s)return;
				self.rd.speed.textContent=((s.freq_mhz||0)/1000).toFixed(2);
				self.rd.volt.textContent=((s.voltage_mv||0)/1000).toFixed(3);
				var t=s.temp_c||0; self.lastTemp=t; self.rd.temp.textContent=t;
				self.rd.temp.style.color=t>80?'#d33':(t>65?'#e67e22':'');
				self.rd.nvme.textContent=s.nvme_c||0; self.rd.nvme.style.fontSize='18px';
				self.rd.load.textContent=s.load||'—'; self.rd.load.style.fontSize='16px';
				self.rd.gov.textContent=s.gov||'—'; self.rd.gov.style.fontSize='14px';
				// throttle status + button
				self.thrOn=(s.throttle==1); self.updateThrBtn();
				if(self.rd.thrStat){
					if(!self.thrOn){ self.rd.thrStat.textContent='⚠ NOT RUNNING'; self.rd.thrStat.style.color='#d33'; }
					else if(t>=THROTTLE_C){ self.rd.thrStat.textContent='⚠ THROTTLING ('+t+'°C)'; self.rd.thrStat.style.color='#d33'; }
					else { self.rd.thrStat.textContent='ON · armed ('+t+'°C)'; self.rd.thrStat.style.color='#27ae60'; }
				}
				// temp sparkline
				self.tempHist.push(t); while(self.tempHist.length>120) self.tempHist.shift();
				drawSpark(self.tempCanvas, self.tempHist);
				var w=document.getElementById('ocp-warn');
				if(w) w.textContent=(s.module==0)?'control module not loaded — controls disabled':'';
				// per-core %
				if(s.cores && s.cores.length){
					if(self.prevCores && self.prevCores.length===s.cores.length){
						s.cores.forEach(function(c,i){
							var db=c.busy-self.prevCores[i].busy, dt=c.total-self.prevCores[i].total;
							var p=dt>0?Math.round(100*db/dt):0; if(p<0)p=0; if(p>100)p=100;
							var el=self.coreEls[i]; if(!el)return;
							el.cell.style.display=''; el.pct.textContent=p+'%';
							el.bar.style.width=p+'%';
							el.bar.style.background=p>85?'#d33':(p>60?'#e67e22':'#2d7dd2');
						});
					}
					self.prevCores=s.cores;
				}
			});
		},2);

		// show last benchmark result (if any) on load
		callBStat().then(function(r){
			if(r && r.done) self.benchCard.textContent=resultText(r);
			else if(r && r.running){ self.benchBtn.disabled=true; self.pollBench(); }
		});
		this.renderHistory();

		return node;
	},

	updateThrBtn: function(){
		if(!this.thrBtn) return;
		this.thrBtn.textContent = this.thrOn ? 'Auto-throttle: ON' : 'Auto-throttle: OFF';
		this.thrBtn.className = 'btn cbi-button ' + (this.thrOn ? 'cbi-button-positive' : 'cbi-button-neutral');
	},

	renderHistory: function(){
		var self=this;
		return callBHist().then(function(r){
			self.histBox.innerHTML='';
			if(!r || !r.runs || !r.runs.length){ self.histBox.appendChild(E('em','No runs recorded yet.')); return; }
			var rows=r.runs.slice().reverse();  // newest first
			var tbl=E('table',{'class':'table','style':'width:100%'});
			tbl.appendChild(E('tr',{'class':'tr table-titles'},[
				E('th',{'class':'th'},'Time'),E('th',{'class':'th'},'Speed'),E('th',{'class':'th'},'Voltage'),
				E('th',{'class':'th'},'Score'),E('th',{'class':'th'},'Peak °C'),E('th',{'class':'th'},'Result')
			]));
			rows.forEach(function(x){
				var pass=(x.stable==='PASS');
				tbl.appendChild(E('tr',{'class':'tr'},[
					E('td',{'class':'td'},x.ts||''),
					E('td',{'class':'td'},((x.speed_mhz||0)/1000).toFixed(2)+' GHz'),
					E('td',{'class':'td'},((x.voltage_mv||0)/1000).toFixed(3)+' V'),
					E('td',{'class':'td','style':'font-weight:700'},''+(x.score||0)),
					E('td',{'class':'td'},''+(x.temp_peak||0)),
					E('td',{'class':'td','style':'color:'+(pass?'#27ae60':'#d33')},pass?'✓ PASS':'✗ FAIL')
				]));
			});
			self.histBox.appendChild(tbl);
		});
	},

	pollBench: function(){
		var self=this;
		callBStat().then(function(r){
			if(!r){ self.benchBtn.disabled=false; return; }
			if(r.running){
				var thr=(self.thrOn && (r.temp_c||0)>=THROTTLE_C)?'   ⚠ THROTTLING':'';
				self.benchCard.textContent='CPU+RAM stability test running…  '+fmtDur(r.elapsed)+' / '+fmtDur(r.duration)+
					'   '+((r.speed_mhz||0)/1000).toFixed(2)+' GHz   '+(r.temp_c||0)+' °C (peak '+(r.temp_peak||r.temp_c||0)+')'+thr;
				window.setTimeout(function(){ self.pollBench(); },2000);
			} else if(r.done){
				self.benchCard.textContent=resultText(r);
				self.benchCard.style.color=(r.stable==='PASS')?'':'#d33';
				self.benchBtn.disabled=false;
				self.renderHistory();  // refresh history table with the new run
			} else { self.benchBtn.disabled=false; }
		});
	},

	handleSaveApply:null, handleSave:null, handleReset:null
});
