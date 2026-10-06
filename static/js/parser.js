async function handleMachineFile() {
    const file = document.getElementById('machineFile').files[0];
    if (!file) return;
    const nameLower = file.name.toLowerCase();

    if (nameLower.endsWith('.3mf') || nameLower.endsWith('.ufp')) {
        await parse3mfContainer(file);
    } else if (nameLower.endsWith('.gx')) {
        await parseFlashForgeGX(file);
    } else {
        await parseStandardGcode(file, "G-CODE");
    }
}

async function parseFlashForgeGX(file) {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    const bytes = new Uint8Array(buf);

    let bmpBase64 = null, binTimeSec = 0, binLengthMm = 0, gcodeOffset = 0;
    const magic = new TextDecoder().decode(bytes.slice(0, 6));

    if (magic === 'xgcode' && buf.byteLength > 58) {
        const off16 = view.getUint32(16, true);
        const off20 = view.getUint32(20, true);
        const off24 = view.getUint32(24, true);

        const bmpStart = off16 > 0 && off16 < 512 ? off16 : 58;
        gcodeOffset = off24 > bmpStart ? off24 : off20;

        binTimeSec = view.getUint32(28, true);
        const ext1Mm = view.getUint32(32, true);
        const ext2Mm = view.getUint32(36, true);
        binLengthMm = ext1Mm + (ext2Mm < 1000000 ? ext2Mm : 0);

        if (bmpStart > 0 && gcodeOffset > bmpStart && gcodeOffset <= buf.byteLength) {
            const bmpBytes = bytes.slice(bmpStart, gcodeOffset);
            if (bmpBytes[0] === 0x42 && bmpBytes[1] === 0x4D) {
                let binary = '';
                for (let i = 0; i < bmpBytes.byteLength; i++) binary += String.fromCharCode(bmpBytes[i]);
                bmpBase64 = 'data:image/bmp;base64,' + btoa(binary);
            }
        }
    }

    const textStart = (gcodeOffset > 0 && gcodeOffset < buf.byteLength) ? gcodeOffset : 0;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(textStart));
    const parsed = extractMetadataFromText(text, file.name, "GX (FlashForge Binary)");

    if (parsed.time_hours === 0 && binTimeSec > 0) {
        parsed.time_hours = parseFloat((binTimeSec / 3600).toFixed(2));
        const h = Math.floor(binTimeSec / 3600);
        const m = Math.round((binTimeSec % 3600) / 60);
        parsed.time_str = h > 0 ? `${h}ч ${m}м` : `${m} мин`;
    }
    if (parsed.length_m === 0 && binLengthMm > 0) {
        parsed.length_m = parseFloat((binLengthMm / 1000).toFixed(2));
    }
    if (parsed.weight_g === 0 && parsed.length_m > 0) {
        parsed.weight_g = parseFloat((parsed.length_m * 3.01).toFixed(1));
    }
    if (bmpBase64) parsed.thumbnail = bmpBase64;

    applyParsedGcode(parsed);
}

async function parse3mfContainer(file) {
    try {
        const zip = await JSZip.loadAsync(file);
        let gcodeText = '', configText = '', thumbData = null;

        for (const [path, zipEntry] of Object.entries(zip.files)) {
            const pLow = path.toLowerCase();
            if (pLow.endsWith('.gcode')) gcodeText = await zipEntry.async('string');
            else if (pLow.includes('slice_info.config')) configText = await zipEntry.async('string');
            else if ((pLow.endsWith('.png') || pLow.endsWith('.jpg')) && !thumbData && pLow.includes('plate')) {
                const b64 = await zipEntry.async('base64');
                thumbData = `data:image/png;base64,${b64}`;
            }
        }

        if (gcodeText) {
            const parsed = extractMetadataFromText(gcodeText, file.name, "3MF (Sliced Archive)");
            if (thumbData) parsed.thumbnail = thumbData;
            applyParsedGcode(parsed);
            return;
        }

        let weight_g = 0, time_hours = 0;
        if (configText) {
            const wMatch = configText.match(/used_g\s*=\s*"?([\d\.]+)"?/i);
            const tMatch = configText.match(/prediction\s*=\s*"?(\d+)"?/i);
            if (wMatch) weight_g = parseFloat(wMatch[1]);
            if (tMatch) time_hours = parseFloat((parseInt(tMatch[1]) / 3600).toFixed(2));
        }
        applyParsedGcode({
            filename: file.name, format: "3MF Container", weight_g,
            length_m: parseFloat((weight_g / 3.01).toFixed(2)),
                         time_str: time_hours ? `${time_hours}ч` : '3MF',
                         time_hours, filament_type: '3MF', layer_height: 0.2, thumbnail: thumbData
        });
    } catch (err) {
        showModal('ОШИБКА ЧТЕНИЯ ФАЙЛА', 'Не удалось распаковать контейнер 3MF: ' + err.message);
    }
}

async function parseStandardGcode(file, formatLabel) {
    const text = await file.text();
    applyParsedGcode(extractMetadataFromText(text, file.name, formatLabel));
}

function extractMetadataFromText(text, filename, formatLabel) {
    const lines = text.split(/\r?\n/);
    let weight_g = 0, length_m = 0, time_str = 'N/A', time_hours = 0;
    let filament_type = 'AUTO', layer_height = 0.2, inThumb = false, thumbLines = [];

    for (let rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith(';')) continue;
        if (line.startsWith('; thumbnail begin')) { inThumb = true; thumbLines = []; continue; }
        if (line.startsWith('; thumbnail end')) { inThumb = false; continue; }
        if (inThumb) { thumbLines.push(line.replace(/^;\s*/, '')); continue; }

        if (line.includes('total filament used [g]') || line.includes('filament used [g]')) {
            const nums = (line.split('=')[1] || '').match(/[\d\.]+/g);
            if (nums) {
                const sum = nums.reduce((a, b) => a + parseFloat(b), 0);
                if (sum > 0) weight_g = parseFloat(sum.toFixed(2));
            }
        } else if (line.includes('filament used [mm]') || line.startsWith(';Filament used:')) {
            const rhs = line.includes('=') ? line.split('=')[1] : line.split(':')[1];
            const nums = (rhs || '').match(/[\d\.]+/g);
            if (nums) {
                let sum = nums.reduce((a, b) => a + parseFloat(b), 0);
                if (line.includes('m') && !line.includes('mm')) sum *= 1000;
                if (sum > 0) length_m = parseFloat((sum / 1000).toFixed(2));
            }
        } else if (line.includes('estimated printing time (normal mode)')) {
            time_str = (line.split('=')[1] || '').trim();
            const d = time_str.match(/(\d+)\s*d/), h = time_str.match(/(\d+)\s*h/);
            const m = time_str.match(/(\d+)\s*m/), s = time_str.match(/(\d+)\s*s/);
            let th = 0;
            if (d) th += parseInt(d[1]) * 24;
            if (h) th += parseInt(h[1]);
            if (m) th += parseInt(m[1]) / 60;
            if (s) th += parseInt(s[1]) / 3600;
            time_hours = parseFloat(th.toFixed(2));
        } else if (line.startsWith(';TIME:') || line.startsWith(';print_time:')) {
            const secs = parseInt(line.split(':')[1] || '0');
            if (secs > 0) {
                time_hours = parseFloat((secs / 3600).toFixed(2));
                time_str = `${Math.floor(secs / 3600)}ч ${Math.floor((secs % 3600) / 60)}м`;
            }
        } else if (line.startsWith('; filament_type =') || line.startsWith(';extruder_filament_type') || line.startsWith(';material_type:')) {
            const sep = line.includes('=') ? '=' : ':';
            filament_type = (line.split(sep)[1] || '').trim().split(';')[0].replace(/"/g, '');
        } else if (line.startsWith('; layer_height =') || line.startsWith(';layer_height:')) {
            const sep = line.includes('=') ? '=' : ':';
            const n = (line.split(sep)[1] || '').match(/[\d\.]+/);
            if (n) layer_height = parseFloat(n[0]);
        }
    }
    if (weight_g === 0 && length_m > 0) weight_g = parseFloat((length_m * 3.01).toFixed(1));
    const thumbnail = thumbLines.length > 5 ? `data:image/png;base64,${thumbLines.join('')}` : null;
    return { filename, format: formatLabel, weight_g, length_m, time_str, time_hours, filament_type, layer_height, thumbnail };
}

async function loadDemoGcode(key) {
    const res = await fetch(`/api/demo_gcode/${key}`);
    const json = await res.json();
    if (json.status === 'success') applyParsedGcode(json.data);
}

function applyParsedGcode(d) {
    document.getElementById('partName').value = d.filename.replace(/\.(gcode|gx|3mf|g|ufp|gco)$/i, '');
    if (d.weight_g > 0) document.getElementById('weightG').value = d.weight_g;
    if (d.time_hours > 0) document.getElementById('timeHours').value = d.time_hours;

    const box = document.getElementById('telemetryBox');
    const img = document.getElementById('partThumb');
    const meta = document.getElementById('gcodeMeta');
    box.classList.remove('hidden');

    if (d.thumbnail) { img.src = d.thumbnail; img.classList.remove('hidden'); }
    else { img.classList.add('hidden'); }

    meta.innerHTML = `
    <div class="font-bold text-zinc-100 uppercase">ФОРМАТ: ${d.format || 'ФАЙЛ'}</div>
    <div>МАТЕРИАЛ: <span class="text-red-400 font-bold">${d.filament_type}</span> // ПРУТОК: <b>${d.length_m} М</b></div>
    <div>ВРЕМЯ: <b>${d.time_str}</b> // СЛОЙ: <b>${d.layer_height} ММ</b></div>
    `;

    const match = SPOOLS.find(s => d.filament_type.toUpperCase().includes(s.material.split(' ')[0].toUpperCase()));
    if (match) document.getElementById('selectedSpool').value = match.id;
    recalculateCost();
}
