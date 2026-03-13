const ADMIN_TOKEN_KEY = 'societyAdminToken';
const MEMBER_TOKEN_KEY = 'societyMemberToken';
const MEMBER_ID_KEY = 'societyMemberId';

const cardsContainer = document.getElementById('summaryCards');

let latestSummary = null;
let resizeTimer = null;
let chartCD = null;
let chartLoan = null;
let chartDividend = null;

function formatINR(value) {
  return `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function setStatus(message, isError = false, targetId = 'statusMsg') {
  const node = document.getElementById(targetId);
  if (!node) return;
  node.textContent = message;
  node.style.color = isError ? '#ffb4c0' : '';
}

function hideGeneratedCredentials() {
  const box = document.getElementById('generatedCredentialBox');
  if (!box) return;
  box.classList.add('hidden');
  box.removeAttribute('data-copy');
  const textNode = document.getElementById('generatedCredentialText');
  if (textNode) textNode.textContent = '';
}

function showGeneratedCredentials(memberName, memberId, password) {
  const box = document.getElementById('generatedCredentialBox');
  const textNode = document.getElementById('generatedCredentialText');
  if (!box || !textNode) return;

  const copyText = `Member Name: ${memberName} | Member ID: ${memberId} | Password: ${password}`;
  const maskedPassword = '*'.repeat(Math.max(String(password || '').length, 8));
  textNode.textContent = `Member Name: ${memberName} | Member ID: ${memberId} | Password: ${maskedPassword}`;
  box.setAttribute('data-copy', copyText);
  box.classList.remove('hidden');
}

async function copyTextToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  document.execCommand('copy');
  document.body.removeChild(textArea);
}

function getAdminToken() {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

function setAdminToken(token) {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function clearAdminToken() {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

function getMemberToken() {
  return localStorage.getItem(MEMBER_TOKEN_KEY);
}

function setMemberToken(token) {
  localStorage.setItem(MEMBER_TOKEN_KEY, token);
}

function clearMemberToken() {
  localStorage.removeItem(MEMBER_TOKEN_KEY);
}

function getMemberIdFromStorage() {
  return localStorage.getItem(MEMBER_ID_KEY);
}

function setMemberIdInStorage(memberId) {
  localStorage.setItem(MEMBER_ID_KEY, memberId);
}

function clearMemberIdFromStorage() {
  localStorage.removeItem(MEMBER_ID_KEY);
}

function clearMemberSession() {
  clearMemberToken();
  clearMemberIdFromStorage();
}

async function api(url, method = 'GET', body, isBinary = false) {
  const isMemberApi = url.startsWith('/api/member');
  const token = isMemberApi ? getMemberToken() : getAdminToken();
  const headers = { 'Content-Type': 'application/json' };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  if (isBinary) {
    if (!response.ok) {
      throw new Error('Download failed.');
    }
    return response.blob();
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }

  return data;
}

async function ensureDashboardAuth() {
  if (!cardsContainer) return;
  if (!getAdminToken()) {
    window.location.href = '/';
    return;
  }

  try {
    await api('/admin/session');
  } catch (_error) {
    clearAdminToken();
    window.location.href = '/';
  }
}

function animateValue(element, targetValue) {
  const isCurrency = `${targetValue}`.includes('₹');
  const numeric = Number(String(targetValue).replace(/[₹,]/g, ''));
  if (!Number.isFinite(numeric)) {
    element.textContent = targetValue;
    return;
  }

  const start = performance.now();
  const duration = 550;

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const current = numeric * (1 - Math.pow(1 - progress, 3));
    element.textContent = isCurrency
      ? `₹${current.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
      : Math.round(current).toString();

    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

function setTableRows(tableId, rowsHtml) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (tbody) tbody.innerHTML = rowsHtml;
}

function setTableLoading(isLoading) {
  document.querySelectorAll('.table-wrap').forEach((wrap) => {
    wrap.classList.toggle('loading', isLoading);
  });
}

function renderCharts(summary) {
  if (typeof Chart === 'undefined') return;

  if (chartCD) chartCD.destroy();
  if (chartLoan) chartLoan.destroy();
  if (chartDividend) chartDividend.destroy();

  const chartDefaults = {
    color: '#dce6ff',
    borderColor: 'rgba(255,255,255,0.12)',
    font: { family: 'Inter, Segoe UI, sans-serif' }
  };

  const cdCtx = document.getElementById('cdChart');
  const loanCtx = document.getElementById('loanDistributionChart');
  const dividendCtx = document.getElementById('dividendHistoryChart');
  if (!cdCtx || !loanCtx || !dividendCtx) return;

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    resizeDelay: 120,
    animation: { duration: 900, easing: 'easeOutQuart' },
    layout: { padding: { top: 8, right: 10, bottom: 4, left: 6 } },
    plugins: { legend: { labels: { color: '#ffffff' } } },
    scales: { x: { ticks: chartDefaults }, y: { ticks: chartDefaults, grid: { color: chartDefaults.borderColor } } }
  };

  chartCD = new Chart(cdCtx, {
    type: 'line',
    data: {
      labels: (summary.cdGrowth || []).map((x) => x.month),
      datasets: [
        {
          label: 'Total CD',
          data: (summary.cdGrowth || []).map((x) => x.value),
          borderColor: '#d8b041',
          backgroundColor: 'rgba(216,176,65,0.2)',
          borderWidth: 3,
          fill: true,
          tension: 0.35,
          pointRadius: 3
        }
      ]
    },
    options: baseOptions
  });

  const distribution = (summary.loanDistribution || []).slice(0, 12);
  chartLoan = new Chart(loanCtx, {
    type: 'bar',
    data: {
      labels: distribution.map((x) => x.memberName),
      datasets: [
        {
          label: 'Approved Loan',
          data: distribution.map((x) => x.amount),
          backgroundColor: 'rgba(216,176,65,0.7)',
          borderColor: '#f7dd92',
          borderWidth: 1,
          borderRadius: 8
        }
      ]
    },
    options: baseOptions
  });

  chartDividend = new Chart(dividendCtx, {
    type: 'line',
    data: {
      labels: (summary.dividendHistory || []).map((x) => x.month),
      datasets: [
        {
          label: 'Dividend',
          data: (summary.dividendHistory || []).map((x) => x.value),
          borderColor: '#8ab4ff',
          backgroundColor: 'rgba(138,180,255,0.2)',
          borderWidth: 3,
          fill: true,
          tension: 0.32,
          pointRadius: 3
        }
      ]
    },
    options: baseOptions
  });
}

function populateMemberSelect(members) {
  const select = document.getElementById('loanMemberSelect');
  if (!select) return;
  select.innerHTML = members
    .map((member) => `<option value="${member._id}">${member.memberId || '-'} • ${member.name}</option>`)
    .join('');
}

function resetMemberForm() {
  const form = document.getElementById('memberManageForm');
  if (!form) return;
  form.reset();
  document.getElementById('memberId').value = '';
  document.getElementById('memberMonthlyCD').value = '5000';
  const memberPassword = document.getElementById('memberPassword');
  if (memberPassword) {
    memberPassword.value = '';
    memberPassword.placeholder = 'Assign Password';
  }
  const saveBtn = document.getElementById('saveMemberBtn');
  if (saveBtn) saveBtn.textContent = 'Add Member';
  hideGeneratedCredentials();
}

async function loadDashboard() {
  if (!cardsContainer) return;

  setTableLoading(true);
  try {
    const data = await api('/summary');
    latestSummary = data;

    const totals = data.totals;
    const cardItems = [
      ['Total Members', totals.totalMembers],
      ['Total CD', formatINR(totals.totalCD)],
      ['Total Loans', formatINR(totals.totalLoans)],
      ['Total Paid', formatINR(totals.totalPaid)],
      ['Total Remaining', formatINR(totals.totalRemaining)],
      ['Total Interest', formatINR(totals.totalInterest)],
      ['Total Dividend', formatINR(totals.totalDividend)],
      ['Total RPD-25', formatINR(totals.totalRPD25)]
    ];

    cardsContainer.innerHTML = cardItems
      .map(
        ([title, value]) => `
          <div class="card">
            <div class="title">${title}</div>
            <div class="value" data-value="${value}">${value}</div>
          </div>
        `
      )
      .join('');

    cardsContainer.querySelectorAll('.value').forEach((el) => {
      animateValue(el, el.getAttribute('data-value') || '0');
    });

    if (totals.totalMembers >= 19) {
      setStatus('Member limit reached (19/19). You cannot add more members.', true, 'memberFormMsg');
    }

    setTableRows(
      'membersTable',
      data.members
        .map(
          (member) => `
          <tr>
            <td>${member.memberId || '-'}</td>
            <td>${member.name}</td>
            <td>${member.email}</td>
            <td>${formatINR(member.totalCD)}</td>
            <td>${formatINR(member.loanAmount)}</td>
            <td>${formatINR(member.paidAmount)}</td>
            <td>${formatINR(member.remainingAmount)}</td>
            <td>${formatINR(member.monthlyDividend)}</td>
            <td>${formatINR(member.totalDividend)}</td>
            <td>${formatINR(member.rpd25)}</td>
            <td>
              <button class="btn-small" onclick="editMember('${member._id}')">Edit</button>
              <button class="btn-small btn-danger" onclick="removeMember('${member._id}')">Remove</button>
            </td>
          </tr>
        `
        )
        .join('')
    );

    setTableRows(
      'loanTable',
      data.loans
        .map((loan) => {
          const createdDate = new Date(loan.createdAt).toLocaleDateString('en-IN');
          let actionButton = '-';
          if (loan.status === 'requested') {
            actionButton = `<button class="btn-small" onclick="approveLoanRequest('${loan._id}', ${loan.suggestedAmount})">Approve</button>
              <button class="btn-small btn-danger" onclick="rejectLoanRequest('${loan._id}')">Reject</button>`;
          }

          return `
            <tr>
              <td>${createdDate}</td>
              <td>${loan.monthKey}</td>
              <td>${loan.memberName}</td>
              <td>${formatINR(loan.suggestedAmount)}</td>
              <td>${formatINR(loan.approvedAmount)}</td>
              <td>${formatINR(loan.paidAmount)}</td>
              <td>${formatINR(loan.remainingAmount)}</td>
              <td>${loan.status}</td>
              <td>${actionButton}</td>
            </tr>
          `;
        })
        .join('')
    );

    setTableRows(
      'txTable',
      data.transactions
        .map(
          (tx) => `
          <tr>
            <td>${tx.month}</td>
            <td>${tx.memberName}</td>
            <td>${formatINR(tx.loanAmount)}</td>
            <td>${formatINR(tx.paidAmount)}</td>
            <td>${formatINR(tx.remainingAmount)}</td>
            <td>${formatINR(tx.interest)}</td>
            <td>${formatINR(tx.monthlyCDAmount)}</td>
            <td>${formatINR(tx.adjCDAmt)}</td>
            <td>${formatINR(tx.totalCumulativeCDAmt)}</td>
            <td>${formatINR(tx.totalCDAmt)}</td>
            <td>${formatINR(tx.monthlyDividend)}</td>
            <td>${formatINR(tx.totalDividend)}</td>
            <td>${formatINR(tx.rpd25RollingPrincipalDeposit)}</td>
          </tr>
        `
        )
        .join('')
    );

    populateMemberSelect(data.members);
    renderCharts(data);
  } catch (error) {
    cardsContainer.innerHTML = `<div class="card"><div class="title">Error</div><div class="value">${error.message}</div></div>`;
  } finally {
    setTableLoading(false);
  }
}

window.editMember = async function editMember(memberObjectId) {
  try {
    const member = await api(`/members/${memberObjectId}`);
    document.getElementById('memberId').value = member._id;
    document.getElementById('memberName').value = member.name;
    document.getElementById('memberEmail').value = member.email;
    document.getElementById('memberMonthlyCD').value = member.monthlyCD;

    const memberPassword = document.getElementById('memberPassword');
    if (memberPassword) {
      memberPassword.value = '';
      memberPassword.placeholder = `Reset password for ${member.memberId} (optional)`;
    }

    const saveBtn = document.getElementById('saveMemberBtn');
    if (saveBtn) saveBtn.textContent = 'Update Member';
    setStatus('Editing member details.', false, 'memberFormMsg');
  } catch (error) {
    setStatus(error.message, true, 'memberFormMsg');
  }
};

window.removeMember = async function removeMember(memberObjectId) {
  if (!confirm('Are you sure you want to remove this member?')) return;

  try {
    await api(`/members/${memberObjectId}`, 'DELETE');
    await loadDashboard();
    setStatus('Member removed successfully.', false, 'memberFormMsg');
  } catch (error) {
    setStatus(error.message, true, 'memberFormMsg');
  }
};

window.approveLoanRequest = async function approveLoanRequest(loanId, suggestedAmount) {
  try {
    const input = prompt('Enter approved amount (leave blank for suggested):', String(suggestedAmount));
    const approvedAmount = input ? Number(input) : suggestedAmount;
    await api('/loan/decision', 'POST', { loanId, action: 'approve', approvedAmount });
    await loadDashboard();
  } catch (error) {
    alert(error.message);
  }
};

window.rejectLoanRequest = async function rejectLoanRequest(loanId) {
  try {
    const reason = prompt('Enter rejection reason:') || 'Not approved';
    await api('/loan/decision', 'POST', { loanId, action: 'reject', rejectedReason: reason });
    await loadDashboard();
  } catch (error) {
    alert(error.message);
  }
};

const loginForm = document.getElementById('loginForm');
if (loginForm) {
  const roleRadios = document.querySelectorAll('input[name="role"]');
  const emailInput = document.getElementById('email');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const loginSubmitLabel = document.getElementById('loginSubmitLabel');

  function setLoginLoading(isLoading) {
    if (!loginSubmitBtn || !loginSubmitLabel) return;
    loginSubmitBtn.disabled = isLoading;
    loginSubmitBtn.classList.toggle('is-loading', isLoading);
    loginSubmitLabel.textContent = isLoading ? 'Logging in...' : 'Sign In';
  }

  function getSelectedRole() {
    const selected = document.querySelector('input[name="role"]:checked');
    return selected ? selected.value : 'admin';
  }

  function syncLoginIdentifierUi() {
    if (!emailInput) return;
    if (getSelectedRole() === 'member') {
      emailInput.type = 'text';
      emailInput.placeholder = 'Member ID';
    } else {
      emailInput.type = 'email';
      emailInput.placeholder = 'Admin Email';
    }
  }

  roleRadios.forEach((radio) => {
    radio.addEventListener('change', syncLoginIdentifierUi);
  });
  syncLoginIdentifierUi();

  if (getAdminToken()) {
    api('/admin/session')
      .then(() => {
        window.location.href = '/dashboard.html';
      })
      .catch(() => {
        clearAdminToken();
      });
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const role = getSelectedRole();
    const identifier = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    setLoginLoading(true);

    try {
      if (role === 'member') {
        const result = await api('/api/member/login', 'POST', {
          memberId: identifier.toUpperCase(),
          password
        });
        setMemberToken(result.token);
        setMemberIdInStorage(result.member.memberId);
        window.location.href = '/memberDashboard.html';
      } else {
        const result = await api('/admin/login', 'POST', { email: identifier, password });
        setAdminToken(result.token);
        window.location.href = '/dashboard.html';
      }
    } catch (error) {
      setStatus(error.message, true, 'statusMsg');
    } finally {
      setLoginLoading(false);
    }
  });
}

const memberLoginForm = document.getElementById('memberLoginForm');
if (memberLoginForm) {
  if (getMemberToken() && getMemberIdFromStorage()) {
    window.location.href = '/memberDashboard.html';
  }

  memberLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const memberId = document.getElementById('memberLoginId').value.trim().toUpperCase();
    const password = document.getElementById('memberPassword').value;

    try {
      const result = await api('/api/member/login', 'POST', { memberId, password });
      setMemberToken(result.token);
      setMemberIdInStorage(result.member.memberId);
      window.location.href = '/memberDashboard.html';
    } catch (error) {
      setStatus(error.message, true, 'memberLoginMsg');
    }
  });
}

const memberManageForm = document.getElementById('memberManageForm');
if (memberManageForm) {
  memberManageForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const memberObjectId = document.getElementById('memberId').value;
    const payload = {
      name: document.getElementById('memberName').value.trim(),
      email: document.getElementById('memberEmail').value.trim(),
      monthlyCD: Number(document.getElementById('memberMonthlyCD').value || 5000)
    };

    const rawPassword = document.getElementById('memberPassword').value.trim();
    if (rawPassword) {
      payload.password = rawPassword;
    }

    try {
      if (memberObjectId) {
        await api(`/members/${memberObjectId}`, 'PUT', payload);
        setStatus('Member updated successfully.', false, 'memberFormMsg');
        hideGeneratedCredentials();
      } else {
        const created = await api('/members', 'POST', payload);
        showGeneratedCredentials(created.name, created.memberId, created.generatedPassword);
        setStatus(
          `Member added: ${created.name} (${created.memberId}) | Password: ${created.generatedPassword}`,
          false,
          'memberFormMsg'
        );
      }

      resetMemberForm();
      await loadDashboard();
    } catch (error) {
      setStatus(error.message, true, 'memberFormMsg');
    }
  });
}

const cancelEditBtn = document.getElementById('cancelEditBtn');
if (cancelEditBtn) {
  cancelEditBtn.addEventListener('click', resetMemberForm);
}

const copyCredentialsBtn = document.getElementById('copyCredentialsBtn');
if (copyCredentialsBtn) {
  copyCredentialsBtn.addEventListener('click', async () => {
    const box = document.getElementById('generatedCredentialBox');
    const text = box ? box.getAttribute('data-copy') || '' : '';
    if (!text) return;

    try {
      await copyTextToClipboard(text);
      setStatus('Member credentials copied to clipboard.', false, 'memberFormMsg');
    } catch (_error) {
      setStatus('Unable to copy credentials automatically. Please copy manually.', true, 'memberFormMsg');
    }
  });
}

const loanRequestForm = document.getElementById('loanRequestForm');
if (loanRequestForm) {
  loanRequestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const memberObjectId = document.getElementById('loanMemberSelect').value;
    if (!memberObjectId) return;

    try {
      await api('/loan/request', 'POST', { memberId: memberObjectId });
      await loadDashboard();
    } catch (error) {
      alert(error.message);
    }
  });
}

const refreshBtn = document.getElementById('refreshBtn');
if (refreshBtn) refreshBtn.addEventListener('click', loadDashboard);

const monthlyCloseBtn = document.getElementById('monthlyCloseBtn');
if (monthlyCloseBtn) {
  monthlyCloseBtn.addEventListener('click', async () => {
    try {
      await api('/monthlyClose', 'POST', { payments: {} });
      await loadDashboard();
      alert('Monthly closing completed successfully.');
    } catch (error) {
      alert(error.message);
    }
  });
}

const downloadReportBtn = document.getElementById('downloadReportBtn');
if (downloadReportBtn) {
  downloadReportBtn.addEventListener('click', async () => {
    try {
      const blob = await api('/report/download', 'GET', null, true);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'society-report.csv';
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      alert(error.message);
    }
  });
}

const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await api('/admin/logout', 'POST');
    } catch (_error) {
    } finally {
      clearAdminToken();
      window.location.href = '/';
    }
  });
}

async function loadMemberDashboard() {
  const memberCards = document.getElementById('memberSummaryCards');
  if (!memberCards) return;

  const memberId = getMemberIdFromStorage();
  if (!memberId || !getMemberToken()) {
    window.location.href = '/memberLogin.html';
    return;
  }

  try {
    const { member, records } = await api(`/api/member/${memberId}/records`);

    document.getElementById('memberHeaderName').textContent = member.name;
    document.getElementById('memberHeaderId').textContent = `Member ID: ${member.memberId}`;

    const cards = [
      ['Total CD', formatINR(member.totalCD)],
      ['Loan Amount', formatINR(member.loanAmount)],
      ['Paid Amount', formatINR(member.paidAmount)],
      ['Remaining Amount', formatINR(member.remainingAmount)],
      ['Total Dividend', formatINR(member.totalDividend)],
      ['RPD-25', formatINR(member.rpd25)]
    ];

    memberCards.innerHTML = cards
      .map(
        ([title, value]) => `
          <div class="card">
            <div class="title">${title}</div>
            <div class="value">${value}</div>
          </div>
        `
      )
      .join('');

    setTableRows(
      'memberRecordsTable',
      records
        .map(
          (row) => `
          <tr>
            <td>${row.month}</td>
            <td>${formatINR(row.loanAmount)}</td>
            <td>${formatINR(row.paidAmount)}</td>
            <td>${formatINR(row.remainingAmount)}</td>
            <td>${formatINR(row.interest)}</td>
            <td>${formatINR(row.monthlyCDAmount)}</td>
            <td>${formatINR(row.adjCDAmt)}</td>
            <td>${formatINR(row.totalCumulativeCDAmt)}</td>
            <td>${formatINR(row.totalCDAmt)}</td>
            <td>${formatINR(row.monthlyDividend)}</td>
            <td>${formatINR(row.totalDividend)}</td>
            <td>${formatINR(row.rpd25RollingPrincipalDeposit)}</td>
          </tr>
        `
        )
        .join('')
    );
  } catch (error) {
    clearMemberSession();
    alert(error.message);
    window.location.href = '/memberLogin.html';
  }
}

const memberRefreshBtn = document.getElementById('memberRefreshBtn');
if (memberRefreshBtn) {
  memberRefreshBtn.addEventListener('click', loadMemberDashboard);
}

const memberLogoutBtn = document.getElementById('memberLogoutBtn');
if (memberLogoutBtn) {
  memberLogoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/member/logout', 'POST');
    } catch (_error) {
    } finally {
      clearMemberSession();
      window.location.href = '/memberLogin.html';
    }
  });
}

if (cardsContainer) {
  ensureDashboardAuth().then(() => {
    if (getAdminToken()) {
      loadDashboard();
    }
  });

  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (latestSummary) renderCharts(latestSummary);
    }, 180);
  });
}

if (document.getElementById('memberSummaryCards')) {
  loadMemberDashboard();
}
