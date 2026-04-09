// dashboard.js - Lógica para dashboard administrativo customizado

document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('tab-dashboard')) return;

  // Função para buscar e renderizar o dashboard
  async function carregarDashboard() {
    const dataFiltro = document.getElementById('dataFiltro');
    const data = dataFiltro ? dataFiltro.value : '';
    const res = await fetch(`/api/relatorios/dashboard/resumo${data ? '?data=' + data : ''}`);
    const dash = await res.json();

    // Atualiza cards principais
    document.getElementById('totalPostaram').textContent = dash.bases.filter(b => b.postou).length;
    document.getElementById('totalNaoPostaram').textContent = dash.bases.filter(b => !b.postou).length;
    document.getElementById('totalDesconto').textContent = dash.bases.reduce((s, b) => s + (Number(b.valor_total)||0), 0).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});

    // Progresso
    const pct = dash.bases.length ? Math.round(100 * dash.bases.filter(b => b.postou).length / dash.bases.length) : 0;
    document.getElementById('pctPostagem').textContent = pct + '%';
    document.getElementById('barPostagem').style.width = pct + '%';

    // Horário limite
    let horaAviso = '';
    if (dash.horaLimite !== undefined) {
      horaAviso = `<span class='badge bg-warning text-dark ms-2'>Limite: ${dash.horaLimite}:00h</span>`;
    }
    document.querySelector('.fw-semibold').innerHTML = 'Progresso de postagem do dia' + horaAviso;

    // Alertas de pendência após 10h
    if (dash.pendentes && dash.pendentes.length > 0) {
      let alerta = `<div class='alert alert-danger'><b>Bases pendentes após ${dash.horaLimite}:00h:</b><ul>`;
      dash.pendentes.forEach(b => {
        alerta += `<li>${b.base_nome} (${b.cidade})</li>`;
      });
      alerta += '</ul></div>';
      document.getElementById('tab-dashboard').insertAdjacentHTML('afterbegin', alerta);
    }

    // Ranking de ocorrências
    let htmlRank = '';
    if (dash.rankingOcorrencias && dash.rankingOcorrencias.length > 0) {
      htmlRank += `<div class='col-md-6'><div class='card mb-3'><div class='card-header bg-danger text-white'><b>Top 5 Bases com Mais Ocorrências</b></div><ul class='list-group list-group-flush'>`;
      dash.rankingOcorrencias.forEach((b, i) => {
        htmlRank += `<li class='list-group-item d-flex justify-content-between align-items-center'>${i+1}. ${b.base_nome} <span class='badge bg-danger'>${b.ocorrencias}</span></li>`;
      });
      htmlRank += '</ul></div></div>';
    }
    if (dash.rankingValores && dash.rankingValores.length > 0) {
      htmlRank += `<div class='col-md-6'><div class='card mb-3'><div class='card-header bg-warning text-dark'><b>Top 5 Bases por Valor de Desconto</b></div><ul class='list-group list-group-flush'>`;
      dash.rankingValores.forEach((b, i) => {
        htmlRank += `<li class='list-group-item d-flex justify-content-between align-items-center'>${i+1}. ${b.base_nome} <span class='badge bg-warning text-dark'>R$ ${(b.valor_total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</span></li>`;
      });
      htmlRank += '</ul></div></div>';
    }
    let rankRow = document.getElementById('dashboardRankings');
    if (!rankRow) {
      rankRow = document.createElement('div');
      rankRow.className = 'row g-3 mb-4';
      rankRow.id = 'dashboardRankings';
      document.getElementById('tab-dashboard').insertBefore(rankRow, document.getElementById('cardsBases'));
    }
    rankRow.innerHTML = htmlRank;
  }

  // Carregar ao abrir
  carregarDashboard();
  if (document.getElementById('dataFiltro')) {
    document.getElementById('dataFiltro').addEventListener('change', carregarDashboard);
  }
});
