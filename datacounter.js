/**
 * アイムジャグラーEX データカウンターモジュール (datacounter.js)
 * ホール仕様のデータ集計・確率計算・当選履歴・出玉スランプグラフ描画モジュール
 */

(function() {
  const DataCounter = {
    totalGames: 0,       // 総回転数
    currentGames: 0,     // 現在のボーナス間ゲーム数
    bigCount: 0,         // BIG回数
    regCount: 0,         // REG回数
    diffMedal: 0,        // 現在の累計差枚数
    
    history: [],         // ボーナス当選履歴 [{ id, type, game, totalGame, time }]
    slumpData: [{ game: 0, diff: 0 }], // スランプグラフ用履歴データ

    init: function() {
      this.reset();
    },

    reset: function() {
      this.totalGames = 0;
      this.currentGames = 0;
      this.bigCount = 0;
      this.regCount = 0;
      this.diffMedal = 0;
      this.history = [];
      this.slumpData = [{ game: 0, diff: 0 }];
    },

    // 1ゲーム毎の差枚数・ゲーム数更新
    onGameStart: function(betCount) {
      this.totalGames++;
      this.currentGames++;
      this.diffMedal -= betCount;
      this.recordSlumpPoint();
    },

    // 払出毎の差枚数更新
    onPayout: function(payout) {
      if (payout > 0) {
        this.diffMedal += payout;
        this.recordSlumpPoint();
      }
    },

    // ボーナス当選時の記録
    onBonusWin: function(type) {
      if (type === 'BIG') {
        this.bigCount++;
      } else if (type === 'REG') {
        this.regCount++;
      }

      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      // 直近の履歴を追加（先頭へ追加）
      this.history.unshift({
        id: this.history.length + 1,
        type: type, // 'BIG' or 'REG'
        game: this.currentGames,
        totalGame: this.totalGames,
        time: timeStr
      });

      // 履歴データの上限（最大50件）
      if (this.history.length > 50) {
        this.history.pop();
      }

      // ボーナス間ゲーム数のリセット
      this.currentGames = 0;
      this.recordSlumpPoint();
    },

    // スランプグラフ用のデータポイント記録
    recordSlumpPoint: function() {
      const lastPoint = this.slumpData[this.slumpData.length - 1];
      // 前回の記録から一定ゲーム数以上経過または差枚に変化があった場合に記録
      if (!lastPoint || this.totalGames - lastPoint.game >= 5 || Math.abs(this.diffMedal - lastPoint.diff) >= 10) {
        this.slumpData.push({
          game: this.totalGames,
          diff: this.diffMedal
        });
      }
    },

    // 各種確率計算のフォーマット文字列取得
    getStats: function() {
      const formatProb = (count, total) => {
        if (count === 0 || total === 0) return '1/--.-';
        return `1/${(total / count).toFixed(1)}`;
      };

      const totalBonus = this.bigCount + this.regCount;

      return {
        totalGames: this.totalGames,
        currentGames: this.currentGames,
        bigCount: this.bigCount,
        regCount: this.regCount,
        totalBonus: totalBonus,
        bigProb: formatProb(this.bigCount, this.totalGames),
        regProb: formatProb(this.regCount, this.totalGames),
        totalProb: formatProb(totalBonus, this.totalGames),
        diffMedal: this.diffMedal
      };
    },

    // ホール風スランプグラフの描画 (Canvas)
    renderSlumpGraph: function(canvasElement) {
      if (!canvasElement) return;
      const ctx = canvasElement.getContext('2d');
      const width = canvasElement.width;
      const height = canvasElement.height;

      // 背景・グリッド描画
      ctx.fillStyle = '#111622';
      ctx.fillRect(0, 0, width, height);

      const padding = { top: 25, right: 20, bottom: 25, left: 45 };
      const graphWidth = width - padding.left - padding.right;
      const graphHeight = height - padding.top - padding.bottom;

      // 差枚の最大値・最小値の計算（レンジ決定）
      let maxDiff = 1000;
      let minDiff = -1000;

      this.slumpData.forEach(p => {
        if (p.diff > maxDiff) maxDiff = Math.ceil(p.diff / 500) * 500;
        if (p.diff < minDiff) minDiff = Math.floor(p.diff / 500) * 500;
      });

      const maxGame = Math.max(3000, this.totalGames + 200);

      // ゼロ基準線のY座標
      const zeroY = padding.top + graphHeight * (maxDiff / (maxDiff - minDiff));

      // グリッド線の描画
      ctx.strokeStyle = '#2a3447';
      ctx.lineWidth = 1;
      
      // 横グリッド線
      const gridStepY = (maxDiff - minDiff) / 4;
      for (let i = 0; i <= 4; i++) {
        const val = maxDiff - (gridStepY * i);
        const y = padding.top + graphHeight * ((maxDiff - val) / (maxDiff - minDiff));
        
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        // 差枚ラベル
        ctx.fillStyle = '#7a8ba6';
        ctx.font = '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText((val > 0 ? '+' : '') + Math.round(val), padding.left - 5, y);
      }

      // ゼロ基準線（赤ライン）
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padding.left, zeroY);
      ctx.lineTo(width - padding.right, zeroY);
      ctx.stroke();

      // スランプ波形ライン描画
      if (this.slumpData.length > 1) {
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.beginPath();

        this.slumpData.forEach((point, idx) => {
          const x = padding.left + (point.game / maxGame) * graphWidth;
          const y = padding.top + graphHeight * ((maxDiff - point.diff) / (maxDiff - minDiff));

          if (idx === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        });
        ctx.stroke();

        // 終点（最新データ）のマーク
        const lastPoint = this.slumpData[this.slumpData.length - 1];
        const lastX = padding.left + (lastPoint.game / maxGame) * graphWidth;
        const lastY = padding.top + graphHeight * ((maxDiff - lastPoint.diff) / (maxDiff - minDiff));

        ctx.fillStyle = '#ffeb3b';
        ctx.beginPath();
        ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // 軸ラベル
      ctx.fillStyle = '#a0b0c8';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ゲーム数(G)', padding.left + graphWidth / 2, height - 6);
    },

    // 当選履歴テーブルのHTMLレンダリング
    renderHistoryHTML: function() {
      if (this.history.length === 0) {
        return '<div style="text-align:center; padding:20px; color:#666;">当選履歴はありません</div>';
      }

      let html = `<table class="history-table">
        <thead>
          <tr>
            <th>回</th>
            <th>種別</th>
            <th>ゲーム数</th>
            <th>累計G</th>
            <th>時間</th>
          </tr>
        </thead>
        <tbody>`;

      this.history.forEach((h, idx) => {
        const typeClass = h.type === 'BIG' ? 'badge-big' : 'badge-reg';
        html += `
          <tr>
            <td>${this.history.length - idx}</td>
            <td><span class="${typeClass}">${h.type}</span></td>
            <td class="highlight">${h.game}G</td>
            <td>${h.totalGame}G</td>
            <td>${h.time}</td>
          </tr>
        `;
      });

      html += '</tbody></table>';
      return html;
    }
  };

  window.DATA_COUNTER = DataCounter;
})();

