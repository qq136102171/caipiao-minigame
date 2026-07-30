document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const toggleExtra = document.getElementById('toggleExtra');
    const toggleHistory = document.getElementById('toggleHistory');
    const lotteryBtns = document.querySelectorAll('.lottery-btn');
    const strategyRow = document.getElementById('strategyRow');
    const ticket = document.querySelector('.ticket');
    const betList = document.getElementById('betList');
    const extraPanel = document.getElementById('extraPanel');
    const structuresEl = document.getElementById('structures');
    const overlapsEl = document.getElementById('overlaps');
    const betCountEl = document.getElementById('betCount');
    const betCostEl = document.getElementById('betCost');
    const currentTimeEl = document.getElementById('currentTime');
    const historyPill = document.getElementById('historyPill');
    const historyPanel = document.getElementById('historyPanel');
    const historyMeta = document.getElementById('historyMeta');
    const historyEmpty = document.getElementById('historyEmpty');
    const historyPerBet = document.getElementById('historyPerBet');
    const hotcold = document.getElementById('hotcold');
    const toast = document.getElementById('toast');

    let currentLottery = 'ssq';

    function updateTime() {
        const now = new Date();
        currentTimeEl.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    updateTime();
    setInterval(updateTime, 60000);

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function showToast(msg) {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    function ballLevelClass(level) {
        if (level === 'hot') return 'level-hot';
        if (level === 'cold') return 'level-cold';
        return 'level-warm';
    }

    function levelLabel(level) {
        if (level === 'hot') return '热';
        if (level === 'cold') return '冷';
        return '温';
    }

    function renderBall(num, cls, level) {
        const levelClass = level ? ` ${ballLevelClass(level)}` : '';
        const tip = level ? ` title="历史${levelLabel(level)}号"` : '';
        return `<span class="ball ${cls}${levelClass}"${tip}>${pad(num)}</span>`;
    }

    /**
     * 把一组号码（红/前/蓝/后）转成带热度信息的球 HTML。
     * statsByNumber: {号码: NumberStat.to_dict()}
     */
    function renderBallsWithStats(numbers, cls, statsList) {
        const byNum = {};
        (statsList || []).forEach(s => { byNum[s.number] = s; });
        return numbers.map(n => {
            const s = byNum[n];
            const level = s ? s.level : null;
            return renderBall(n, cls, level);
        }).join('');
    }

    function renderSsqRow(bet, index, analysis) {
        const statsMap = {};
        const secMap = {};
        if (analysis) {
            analysis.primary_stats.forEach(s => { statsMap[s.number] = s; });
            analysis.secondary_stats.forEach(s => { secMap[s.number] = s; });
        }
        const reds = bet.reds.map(n => {
            const s = statsMap[n];
            const tip = s ? ` title="历史 ${s.frequency} 次 / 出现率 ${(s.rate*100).toFixed(1)}%"` : '';
            return `<span class="ball red ${s ? ballLevelClass(s.level) : ''}"${tip}>${pad(n)}<span class="ball-sub">${s ? s.frequency : '·'}</span></span>`;
        }).join('');
        const sBlue = secMap[bet.blue];
        const blueTip = sBlue ? ` title="历史 ${sBlue.frequency} 次 / 出现率 ${(sBlue.rate*100).toFixed(1)}%"` : '';
        const blue = `<span class="ball blue ${sBlue ? ballLevelClass(sBlue.level) : ''}"${blueTip}>${pad(bet.blue)}<span class="ball-sub">${sBlue ? sBlue.frequency : '·'}</span></span>`;

        const summary = analysis ? renderBetSummary(analysis, 'ssq') : '';

        return `
            <div class="bet-row">
                <div class="bet-index">${pad(index)}</div>
                <div class="bet-balls">${reds}<span class="ball-sep"></span>${blue}</div>
                <div class="bet-label">${bet.label}</div>
            </div>
            ${summary}
        `;
    }

    function renderDltRow(bet, index, analysis) {
        const statsMap = {};
        const secMap = {};
        if (analysis) {
            analysis.primary_stats.forEach(s => { statsMap[s.number] = s; });
            analysis.secondary_stats.forEach(s => { secMap[s.number] = s; });
        }
        const fronts = bet.fronts.map(n => {
            const s = statsMap[n];
            const tip = s ? ` title="历史 ${s.frequency} 次 / 出现率 ${(s.rate*100).toFixed(1)}%"` : '';
            return `<span class="ball red ${s ? ballLevelClass(s.level) : ''}"${tip}>${pad(n)}<span class="ball-sub">${s ? s.frequency : '·'}</span></span>`;
        }).join('');
        const backs = bet.backs.map(n => {
            const s = secMap[n];
            const tip = s ? ` title="历史 ${s.frequency} 次 / 出现率 ${(s.rate*100).toFixed(1)}%"` : '';
            return `<span class="ball back ${s ? ballLevelClass(s.level) : ''}"${tip}>${pad(n)}<span class="ball-sub">${s ? s.frequency : '·'}</span></span>`;
        }).join('');

        const summary = analysis ? renderBetSummary(analysis, 'dlt') : '';

        return `
            <div class="bet-row">
                <div class="bet-index">${pad(index)}</div>
                <div class="bet-balls">${fronts}<span class="ball-sep"></span>${backs}</div>
                <div class="bet-label">${bet.label}</div>
            </div>
            ${summary}
        `;
    }

    function renderBetSummary(analysis, kind) {
        const pAvg = (analysis.primary_avg_hits || 0).toFixed(2);
        const sAvg = (analysis.secondary_avg_hits || 0).toFixed(2);
        const breakdown = analysis.level_breakdown || {};
        const pLabel = kind === 'ssq' ? '红球' : '前区';
        const sLabel = kind === 'ssq' ? '蓝球' : '后区';
        const fullMatch = analysis.full_match_count || 0;
        const fullMatchIssues = analysis.full_match_issues || [];
        const matchHtml = fullMatch > 0
            ? `<span class="match-tag">完全匹配 ${fullMatch} 期${fullMatchIssues.length ? '（' + fullMatchIssues.slice(0,3).join('、') + '）' : ''}</span>`
            : '';

        return `
            <div class="bet-summary">
                <span class="summary-tag">${pLabel} 平均命中 ${pAvg}</span>
                <span class="summary-tag">${sLabel} 平均命中 ${sAvg}</span>
                <span class="summary-tag">
                    热度:
                    <span class="heat heat-hot">热 ${breakdown.hot || 0}</span>
                    <span class="heat heat-warm">温 ${breakdown.warm || 0}</span>
                    <span class="heat heat-cold">冷 ${breakdown.cold || 0}</span>
                </span>
                ${matchHtml}
            </div>
        `;
    }

    function renderExtra(data) {
        if (!data.structures || data.structures.length === 0) {
            structuresEl.innerHTML = '<div class="structure-row"><span class="structure-name">暂无结构信息</span></div>';
        } else {
            structuresEl.innerHTML = data.structures.map(s => `
                <div class="structure-row">
                    <span class="structure-name">${s[0]}</span>
                    <span class="structure-nums">${s[1].map(n => pad(n)).join(' ')}</span>
                </div>
            `).join('');
        }

        if (!data.overlap_checks || data.overlap_checks.length === 0) {
            overlapsEl.innerHTML = '<div class="overlap-row"><span class="overlap-name">暂无重叠检查</span></div>';
        } else {
            overlapsEl.innerHTML = data.overlap_checks.map(o => {
                const ok = o.count <= o.limit;
                return `
                    <div class="overlap-row">
                        <span class="overlap-name">${o.name}（限≤${o.limit}）</span>
                        <span class="overlap-count ${ok ? 'ok' : 'warn'}">${o.count} 个</span>
                    </div>
                `;
            }).join('');
        }
    }

    function renderHistory(data) {
        const history = data.history;
        if (!history) {
            historyEmpty.style.display = 'block';
            historyEmpty.textContent = '暂无历史数据。运行 .venv/bin/python fetch_history.py fetch --type ' + data.lottery_type + ' --limit 200 拉取数据后即可查看分析。';
            historyPerBet.innerHTML = '';
            hotcold.innerHTML = '';
            historyMeta.textContent = '';
            historyPill.textContent = '样本 0';
            historyPill.title = '暂无历史数据';
            historyPill.classList.add('pill-empty');
            return;
        }
        const summary = history.summary || {};
        const total = summary.total_draws || 0;
        historyPill.classList.remove('pill-empty');
        if (total > 0) {
            historyPill.textContent = `样本 ${total}`;
            historyPill.title = `历史 ${summary.earliest_issue} - ${summary.latest_issue}`;
            historyMeta.textContent = total > 0 ? `（共 ${total} 期，${summary.earliest_issue} → ${summary.latest_issue}）` : '';
        } else {
            historyPill.textContent = '样本 0';
            historyPill.title = '暂无历史数据';
            historyPill.classList.add('pill-empty');
            historyMeta.textContent = '';
        }

        if (total === 0) {
            historyEmpty.style.display = 'block';
            historyPerBet.innerHTML = '';
            hotcold.innerHTML = '';
            return;
        }
        historyEmpty.style.display = 'none';

        const perBet = history.per_bet || [];
        historyPerBet.innerHTML = perBet.map((a, i) => {
            const bet = data.bets[i];
            const pAvg = (a.primary_avg_hits || 0).toFixed(2);
            const sAvg = (a.secondary_avg_hits || 0).toFixed(2);
            const breakdown = a.level_breakdown || {};
            const pLabel = data.lottery_type === 'ssq' ? '红球' : '前区';
            const sLabel = data.lottery_type === 'ssq' ? '蓝球' : '后区';
            const dist = a.primary_hit_distribution || {};
            const distStr = Object.entries(dist).map(([k, v]) => `${k}中${v}`).join(' · ');
            const matchTag = a.full_match_count > 0
                ? `<span class="match-tag">完全匹配 ${a.full_match_count} 期</span>`
                : `<span class="match-tag empty">无完全匹配</span>`;

            return `
                <div class="per-bet-card">
                    <div class="per-bet-head">
                        <span class="per-bet-title">${bet.label || '注 ' + (i+1)} · 历史命中分析</span>
                    </div>
                    <div class="per-bet-stats">
                        <span class="summary-tag">${pLabel} 平均 ${pAvg} 个/期</span>
                        <span class="summary-tag">${sLabel} 平均 ${sAvg} 个/期</span>
                        <span class="summary-tag">
                            热度
                            <span class="heat heat-hot">热 ${breakdown.hot || 0}</span>
                            <span class="heat heat-warm">温 ${breakdown.warm || 0}</span>
                            <span class="heat heat-cold">冷 ${breakdown.cold || 0}</span>
                        </span>
                        ${matchTag}
                    </div>
                    <div class="per-bet-dist">
                        <span class="dist-label">${pLabel}命中分布：</span>
                        <span class="dist-text">${distStr || '—'}</span>
                    </div>
                </div>
            `;
        }).join('');

        // 热号冷号：直接 fetch，避免传太大 payload
        fetchHotCold(data.lottery_type);
    }

    async function fetchHotCold(lotteryType) {
        try {
            const resp = await fetch(`/api/history/stats?type=${lotteryType}&n=5`);
            const data = await resp.json();
            if (data.total_draws === 0) {
                hotcold.innerHTML = '';
                return;
            }
            hotcold.innerHTML = renderHotCold(data, lotteryType);
        } catch (e) {
            hotcold.innerHTML = '';
        }
    }

    function renderHotCold(data, lotteryType) {
        const pLabel = lotteryType === 'ssq' ? '红球' : '前区';
        const sLabel = lotteryType === 'ssq' ? '蓝球' : '后区';
        const section = (title, items, kind) => {
            if (!items || !items.length) return '';
            const balls = items.map(it =>
                `<span class="mini-ball ${kind === 'hot' ? 'level-hot' : 'level-cold'}">${pad(it.number)}<span class="mini-sub">${it.frequency}</span></span>`
            ).join('');
            const tag = kind === 'hot' ? '🔥' : '❄️';
            return `
                <div class="hotcold-row">
                    <span class="hotcold-name">${tag} ${title}</span>
                    <span class="hotcold-balls">${balls}</span>
                </div>
            `;
        };
        return `
            ${section(pLabel + ' 热号', data.primary_hot, 'hot')}
            ${section(pLabel + ' 冷号', data.primary_cold, 'cold')}
            ${section(sLabel + ' 热号', data.secondary_hot, 'hot')}
            ${section(sLabel + ' 冷号', data.secondary_cold, 'cold')}
        `;
    }

    function render(data) {
        currentLottery = data.lottery_type;

        if (currentLottery === 'dlt') {
            ticket.classList.add('dlt');
            strategyRow.style.display = 'none';
            const perBet = (data.history && data.history.per_bet) || [];
            betList.innerHTML = data.bets.map((b, i) => renderDltRow(b, i + 1, perBet[i])).join('');
        } else {
            ticket.classList.remove('dlt');
            strategyRow.style.display = 'flex';
            const perBet = (data.history && data.history.per_bet) || [];
            betList.innerHTML = data.bets.map((b, i) => renderSsqRow(b, i + 1, perBet[i])).join('');
        }

        betCountEl.textContent = `${data.total_bets} 注`;
        betCostEl.textContent = `${data.total_cost} 元`;

        renderExtra(data);
        renderHistory(data);
    }

    async function generate() {
        generateBtn.disabled = true;
        generateBtn.innerHTML = '<span class="icon">⏳</span><span>生成中...</span>';
        try {
            const payload = { lottery_type: currentLottery };
            const resp = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();
            render(data);
        } catch (e) {
            showToast('生成失败，请重试');
        } finally {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<span class="icon">🎱</span><span>生成一注</span>';
        }
    }

    lotteryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            lotteryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentLottery = btn.dataset.lottery;
            generate();
        });
    });

    generateBtn.addEventListener('click', generate);

    toggleExtra.addEventListener('click', () => {
        extraPanel.style.display = extraPanel.style.display === 'none' ? 'block' : 'none';
    });

    toggleHistory.addEventListener('click', () => {
        historyPanel.style.display = historyPanel.style.display === 'none' ? 'block' : 'none';
    });

    generate();
});
