let CURRENT_WS = localStorage.getItem('filament_user_key') || 'demo';
let DEMO_ACTIONS_COUNT = 0;
let SPOOLS = [];

function showModal(title, message, isSuccess = false) {
    const box = document.getElementById('infoModalBox');
    const titleEl = document.getElementById('infoTitle');
    document.getElementById('infoText').textContent = message;
    titleEl.textContent = title;

    if (isSuccess) {
        box.className = "panel border-emerald-500 max-w-md w-full p-6 space-y-4 mono";
        titleEl.className = "text-sm font-bold uppercase text-emerald-400";
    } else {
        box.className = "panel border-red-500 max-w-md w-full p-6 space-y-4 mono";
        titleEl.className = "text-sm font-bold uppercase text-red-500";
    }
    document.getElementById('infoModal').classList.remove('hidden');
}

function closeInfoModal() {
    document.getElementById('infoModal').classList.add('hidden');
}

function updateHeaderUI() {
    const isDemo = (CURRENT_WS === 'demo');
    const dot = document.getElementById('statusDot');
    const label = document.getElementById('currentKeyLabel');
    const title = document.getElementById('warehouseTitle');
    const btnExit = document.getElementById('btnExitKey');
    const btnResetDemo = document.getElementById('btnResetDemo');

    if (isDemo) {
        dot.className = "w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse";
        label.className = "font-bold text-amber-400";
        label.textContent = "ДЕМО-ПЕСОЧНИЦА";
        title.textContent = "02 // СКЛАД ФИЛАМЕНТА (ДЕМО-ПЕСОЧНИЦА)";
        btnExit.classList.add('hidden');
        btnResetDemo.classList.remove('hidden');
    } else {
        dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500";
        label.className = "font-bold text-emerald-400";
        label.textContent = CURRENT_WS;
        title.textContent = `02 // СКЛАД ФИЛАМЕНТА [${CURRENT_WS}]`;
        btnExit.classList.remove('hidden');
        btnResetDemo.classList.add('hidden');
        document.getElementById('onboardingBanner').classList.add('hidden');
    }
}

function trackDemoAction() {
    if (CURRENT_WS !== 'demo') return;
    DEMO_ACTIONS_COUNT += 1;
    if (DEMO_ACTIONS_COUNT >= 2) {
        document.getElementById('onboardingBanner').classList.remove('hidden');
    }
}

function openKeyModal() {
    document.getElementById('existingKeyInput').value = CURRENT_WS === 'demo' ? '' : CURRENT_WS;
    document.getElementById('keyModal').classList.remove('hidden');
}

function closeKeyModal() {
    document.getElementById('keyModal').classList.add('hidden');
}

async function loginWithExistingKey() {
    const val = document.getElementById('existingKeyInput').value.trim().toUpperCase();
    const res = await fetch('/api/key/login', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ key: val })
    });
    const data = await res.json();
    if (data.status === 'success') {
        CURRENT_WS = data.key;
        localStorage.setItem('filament_user_key', CURRENT_WS);
        closeKeyModal();
        loadState();
    } else {
        showModal(data.title || 'ОШИБКА АВТОРИЗАЦИИ', data.message);
    }
}

async function generateRandomKey() {
    const res = await fetch('/api/key/generate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.status === 'success') {
        CURRENT_WS = data.key;
        localStorage.setItem('filament_user_key', CURRENT_WS);
        closeKeyModal();
        loadState();
        showModal('КЛЮЧ СКЛАДА СОЗДАН', `Ваш персональный ключ: ${CURRENT_WS}\nСохраните его — по нему вы сможете войти в свой склад с любых ваших устройств.`, true);
    }
}

function switchToDemo() {
    CURRENT_WS = 'demo';
    localStorage.removeItem('filament_user_key');
    loadState();
}

async function resetDemoSandbox() {
    await fetch('/api/demo/reset', { method: 'POST' });
    loadState();
}

async function loadState() {
    const res = await fetch(`/api/state?workspace=${encodeURIComponent(CURRENT_WS)}`);
    const data = await res.json();
    if (data.workspace === 'demo' && CURRENT_WS !== 'demo') {
        CURRENT_WS = 'demo';
        localStorage.removeItem('filament_user_key');
    }
    SPOOLS = data.spools;
    updateHeaderUI();
    renderSpools();
    renderHistory(data.history);
    recalculateCost();
}

function renderSpools() {
    const list = document.getElementById('spoolsList');
    const select = document.getElementById('selectedSpool');
    const prev = select.value;
    list.innerHTML = '';
    select.innerHTML = '';

    let totalG = 0;
    SPOOLS.forEach(s => {
        totalG += s.remaining_weight_g;
        const pct = Math.min(100, Math.round((s.remaining_weight_g / s.initial_weight_g) * 100));
        const isEmpty = s.remaining_weight_g <= 0;
        const bar = isEmpty ? 'bg-zinc-700' : (s.remaining_weight_g < 150 ? 'bg-red-500' : 'bg-zinc-200');

        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `[${s.material}] ${s.brand} (${s.color_name}) — ${s.remaining_weight_g}g ${isEmpty ? '[ПУСТАЯ]' : ''}`;
        select.appendChild(opt);

        list.innerHTML += `
        <div class="border ${isEmpty ? 'border-red-900/50 opacity-75' : 'border-zinc-800'} bg-zinc-950 p-3.5 flex flex-col justify-between space-y-3 mono">
        <div class="flex justify-between items-start gap-2">
        <div class="flex items-center gap-2 min-w-0">
        <span class="w-3.5 h-3.5 border border-zinc-600 shrink-0" style="background-color: ${s.color_hex}"></span>
        <div class="truncate">
        <div class="font-bold text-xs text-zinc-100 uppercase truncate">${s.material} // ${s.brand}</div>
        <div class="text-[11px] text-zinc-500 truncate">${s.color_name} · ${s.price_rub} RUB</div>
        </div>
        </div>
        <button onclick="deleteSpool(${s.id})" title="Удалить" class="text-zinc-600 hover:text-red-500 text-[11px] shrink-0">DEL</button>
        </div>

        <div>
        <div class="flex justify-between text-[11px] mb-1">
        <span class="text-zinc-500">ОСТАТОК:</span>
        <span class="font-bold ${s.remaining_weight_g < 150 ? 'text-red-400' : 'text-zinc-200'}">
        ${s.remaining_weight_g}/${s.initial_weight_g}г (${pct}%)
        </span>
        </div>
        <div class="w-full bg-zinc-900 h-1.5 overflow-hidden">
        <div class="${bar} h-full transition-all" style="width: ${pct}%"></div>
        </div>
        </div>

        <div class="flex justify-between items-center pt-2 border-t border-zinc-900 text-[11px] gap-1">
        <div class="flex gap-1">
        <button onclick="quickAdjust(${s.id}, ${s.remaining_weight_g}, ${s.initial_weight_g}, -50)" class="border border-zinc-800 hover:border-zinc-500 px-1.5 py-0.5 text-zinc-400">-50</button>
        <button onclick="quickAdjust(${s.id}, ${s.remaining_weight_g}, ${s.initial_weight_g}, -10)" class="border border-zinc-800 hover:border-zinc-500 px-1.5 py-0.5 text-zinc-400">-10</button>
        <button onclick="quickAdjust(${s.id}, ${s.remaining_weight_g}, ${s.initial_weight_g}, 10)" class="border border-zinc-800 hover:border-zinc-500 px-1.5 py-0.5 text-zinc-400">+10</button>
        <button onclick="quickAdjust(${s.id}, ${s.remaining_weight_g}, ${s.initial_weight_g}, 50)" class="border border-zinc-800 hover:border-zinc-500 px-1.5 py-0.5 text-zinc-400">+50</button>
        </div>
        <div class="flex items-center gap-1">
        <input id="inlineW_${s.id}" type="number" min="0" max="${s.initial_weight_g}" value="${s.remaining_weight_g}"
        onchange="setExactWeight(${s.id}, this.value, ${s.initial_weight_g})"
        class="w-14 bg-zinc-900 border border-zinc-800 px-1 py-0.5 text-right text-zinc-200">
        </div>
        </div>
        </div>
        `;
    });
    if (prev && SPOOLS.some(s => s.id == prev)) select.value = prev;
    document.getElementById('totalStockSummary').textContent =
    `КАТУШЕК: ${SPOOLS.length} ШТ. // ОБЩИЙ ЗАПАС: ${Math.round(totalG)} Г (${(totalG / 1000).toFixed(2)} КГ)`;
}

function renderHistory(history) {
    const box = document.getElementById('historyList');
    if (!history.length) {
        box.innerHTML = '<div class="text-zinc-600">ЖУРНАЛ ПУСТ</div>';
        return;
    }
    box.innerHTML = history.map(h => {
        const isFail = h.part_name.startsWith('[БРАК]');
        return `
        <div class="flex justify-between items-center bg-zinc-900/60 px-3 py-2 border ${isFail ? 'border-red-900/60' : 'border-zinc-800'}">
        <div class="truncate pr-2">
        <span class="font-bold ${isFail ? 'text-red-400' : 'text-zinc-200'}">${h.part_name}</span>
        <span class="text-zinc-500 ml-1">[-${h.weight_used_g}г · ${h.material || 'SPOOL'}]</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
        <span class="text-zinc-300">${h.cost_rub} RUB</span>
        <button onclick="undoPrint(${h.id})" class="text-red-400 hover:underline uppercase">ВЕРНУТЬ</button>
        </div>
        </div>
        `;
    }).join('');
}

function recalculateCost() {
    const weight = parseFloat(document.getElementById('weightG').value) || 0;
    const hours = parseFloat(document.getElementById('timeHours').value) || 0;
    const spoolId = parseInt(document.getElementById('selectedSpool').value);
    const spool = SPOOLS.find(s => s.id === spoolId);
    const btn = document.getElementById('btnDeduct');
    const btnFail = document.getElementById('btnFailDeduct');
    const st = document.getElementById('spoolCheckStatus');

    if (!spool) {
        btn.disabled = true;
        btnFail.disabled = true;
        st.textContent = "НЕТ ВЫБРАННОЙ КАТУШКИ";
        return;
    }

    const plasticCost = weight * (spool.price_rub / spool.initial_weight_g);
    const elecCost = hours * 6.0;
    const total = plasticCost + elecCost;

    document.getElementById('calcTotalCost').textContent = `${Math.round(total)} RUB`;
    document.getElementById('calcPlasticCost').textContent = `МАТЕРИАЛ: ${plasticCost.toFixed(1)} RUB`;
    document.getElementById('calcElecCost').textContent = `ЭНЕРГИЯ/ИЗНОС: ${elecCost.toFixed(1)} RUB`;

    if (spool.remaining_weight_g <= 0) {
        btn.disabled = true;
        btnFail.disabled = true;
        st.className = "text-xs font-bold text-red-500 pt-1";
        st.textContent = "ВЫБРАННАЯ КАТУШКА ПУСТА (0 Г)";
    } else if (weight <= 0) {
        btn.disabled = true;
        btnFail.disabled = true;
        st.className = "text-xs font-bold text-red-500 pt-1";
        st.textContent = "УКАЖИТЕ МАССУ БОЛЬШЕ 0 Г";
    } else if (spool.remaining_weight_g < weight) {
        btn.disabled = false;
        btnFail.disabled = false;
        st.className = "text-xs font-bold text-red-500 pt-1";
        st.textContent = `ДЕФИЦИТ: НА КАТУШКЕ ${spool.remaining_weight_g} Г (НЕ ХВАТАЕТ ${(weight - spool.remaining_weight_g).toFixed(1)} Г)`;
    } else {
        btn.disabled = false;
        btnFail.disabled = false;
        const rem = (spool.remaining_weight_g - weight).toFixed(1);
        st.className = "text-xs font-bold text-emerald-400 pt-1";
        st.textContent = `СТАТУС ОК // ОСТАНЕТСЯ НА КАТУШКЕ: ${rem} Г`;
    }
}

async function deductFromSpool(isFailed = false) {
    const weight = parseFloat(document.getElementById('weightG').value) || 0;
    const spoolId = parseInt(document.getElementById('selectedSpool').value);
    const spool = SPOOLS.find(s => s.id === spoolId);

    if (!spool || spool.remaining_weight_g <= 0) return;

    if (weight > spool.remaining_weight_g) {
        showModal(
            'НЕДОСТАТОЧНО ПЛАСТИКА НА КАТУШКЕ',
            `Невозможно списать ${weight} г с катушки "${spool.material} // ${spool.brand}", так как на ней осталось всего ${spool.remaining_weight_g} г (не хватает ${(weight - spool.remaining_weight_g).toFixed(1)} г).`
        );
        return;
    }

    const res = await fetch('/api/deduct', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            workspace: CURRENT_WS,
            spool_id: spoolId,
            weight_used_g: weight,
            part_name: document.getElementById('partName').value,
                             cost_rub: parseFloat(document.getElementById('calcTotalCost').textContent) || 0,
                             is_failed: isFailed
        })
    });
    const json = await res.json();
    if (json.status === 'success') {
        trackDemoAction();
        loadState();
    } else {
        showModal(json.title || 'ОШИБКА СПИСАНИЯ', json.message);
    }
}

async function quickAdjust(id, curW, maxW, delta) {
    const clamped = Math.max(0, Math.min(maxW, parseFloat((curW + delta).toFixed(1))));
    if (clamped === curW) return;
    await setExactWeight(id, clamped, maxW);
}

async function setExactWeight(id, val, maxW) {
    let num = parseFloat(val);
    if (isNaN(num)) num = 0;
    num = Math.max(0, Math.min(maxW, num));
    await fetch('/api/spools/update_weight', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ workspace: CURRENT_WS, spool_id: id, remaining_weight_g: num })
    });
    trackDemoAction();
    loadState();
}

async function addNewSpool() {
    const brand = document.getElementById('newBrand').value.trim() || '-';
    const colorName = document.getElementById('newColorName').value.trim() || '-';
    const initW = parseFloat(document.getElementById('newInitWeight').value) || 0;
    const remW = parseFloat(document.getElementById('newRemWeight').value) || 0;

    if (remW > initW) {
        showModal('ОШИБКА ЕМКОСТИ КАТУШКИ', `Текущий остаток (${remW} г) не может превышать полную емкость катушки (${initW} г).`);
        return;
    }

    const res = await fetch('/api/spools/add', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            workspace: CURRENT_WS,
            brand,
            material: document.getElementById('newMaterial').value,
                             color_name: colorName,
                             color_hex: document.getElementById('newColorHex').value,
                             price_rub: document.getElementById('newPrice').value,
                             initial_weight_g: initW,
                             remaining_weight_g: remW
        })
    });
    const json = await res.json();
    if (json.status === 'success') {
        trackDemoAction();
        loadState();
    } else {
        showModal(json.title || 'ОШИБКА ДОБАВЛЕНИЯ КАТУШКИ', json.message);
    }
}

async function deleteSpool(id) {
    if (!confirm('Удалить катушку со склада?')) return;
    await fetch(`/api/spools/delete/${id}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ workspace: CURRENT_WS })
    });
    trackDemoAction();
    loadState();
}

async function undoPrint(id) {
    await fetch(`/api/history/undo/${id}`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ workspace: CURRENT_WS })
    });
    loadState();
}

// Защита от ввода 'e', 'E', '+', '-' во всех числовых полях
document.addEventListener('keydown', function(e) {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
        if (['e', 'E', '+', '-'].includes(e.key)) {
            e.preventDefault();
        }
    }
});
document.addEventListener('input', function(e) {
    if (e.target.tagName === 'INPUT' && e.target.type === 'number') {
        e.target.value = e.target.value.replace(/[eE+\-]/g, '');
    }
});

window.onload = loadState;
