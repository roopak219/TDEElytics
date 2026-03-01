// Global State
let rawData = [];
let currentRange = '14'; // Days
let currentUser = localStorage.getItem('mf_user') || 'default';
let currentPin = localStorage.getItem('mf_pin') || '';
let currentGoal = localStorage.getItem('mf_goal') || 'maintain';
let weightChartInstance = null;
let macroChartInstance = null;

// DOM Elements
const form = document.getElementById('log-form');
const dateDisplay = document.getElementById('current-date');
const dateInput = document.getElementById('entry-date');
const timeToggles = document.querySelectorAll('.toggle-btn');
const toastEl = document.getElementById('toast');
const welcomeMsg = document.getElementById('welcome-msg');

// New DOM Elements
const userSelect = document.getElementById('user-select');
const goalSelect = document.getElementById('goal-select');
const pinModal = document.getElementById('pin-modal');
const pinInput = document.getElementById('pin-input');
const btnPinSubmit = document.getElementById('btn-pin-submit');
const btnReset = document.getElementById('btn-reset');

// Colors from CSS
const colors = {
    weight: '#e2e8f0',
    trend: '#8b5cf6',
    protein: '#ec4899',
    carbs: '#3b82f6',
    fats: '#eab308',
    cals: '#10b981',
    grid: 'rgba(255, 255, 255, 0.05)',
    text: '#94a3b8'
};

// Initialize
function init() {
    // Set today's date and restrictions
    const today = new Date();
    dateDisplay.textContent = today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    // Create Date constraints (Max today, Min 3 days ago)
    const todayStr = today.toISOString().split('T')[0];
    const minDate = new Date(today);
    minDate.setDate(minDate.getDate() - 3);
    const minStr = minDate.toISOString().split('T')[0];

    dateInput.value = todayStr;
    dateInput.max = todayStr;
    dateInput.min = minStr;

    // Setup Chart Defaults
    Chart.defaults.color = colors.text;
    Chart.defaults.font.family = "'Outfit', sans-serif";

    // Set UI to match state
    if (!userSelect.querySelector(`option[value="${currentUser}"]`)) {
        const opt = document.createElement('option');
        opt.value = currentUser;
        opt.textContent = currentUser;
        userSelect.appendChild(opt);
    }
    userSelect.value = currentUser;
    goalSelect.value = currentGoal;
    welcomeMsg.textContent = `Welcome back, ${currentUser}`;

    // Setup Listeners
    form.addEventListener('submit', handleFormSubmit);
    timeToggles.forEach(btn => btn.addEventListener('click', handleToggle));
    userSelect.addEventListener('change', handleUserChange);
    goalSelect.addEventListener('change', handleGoalChange);
    btnPinSubmit.addEventListener('click', handlePinSubmit);
    btnReset.addEventListener('click', handleReset);

    // Initial check
    checkAuthAndFetch();
}

function checkAuthAndFetch() {
    if (!currentPin) {
        showPinModal();
    } else {
        fetchData();
    }
}

function showPinModal() {
    pinInput.value = '';
    pinModal.classList.remove('hidden');
    pinInput.focus();
}

function handlePinSubmit() {
    const pin = pinInput.value.trim();
    if (pin.length !== 4) {
        showToast("PIN must be 4 characters", "error");
        return;
    }
    currentPin = pin;
    localStorage.setItem('mf_pin', currentPin);
    pinModal.classList.add('hidden');
    fetchData();
}

async function handleUserChange(e) {
    if (e.target.value === 'new') {
        const newUser = prompt("Enter new user name:");
        if (newUser) {
            currentUser = newUser;
            localStorage.setItem('mf_user', currentUser);
            // reset pin for new user flow
            currentPin = '';
            localStorage.removeItem('mf_pin');
            location.reload();
        } else {
            userSelect.value = currentUser; // revert
        }
    } else {
        currentUser = e.target.value;
        localStorage.setItem('mf_user', currentUser);
        welcomeMsg.textContent = `Welcome back, ${currentUser}`;
        currentPin = ''; // force pin re-entry on user switch
        localStorage.removeItem('mf_pin');
        showPinModal();
    }
}

function handleGoalChange(e) {
    currentGoal = e.target.value;
    localStorage.setItem('mf_goal', currentGoal);
    fetchData(); // re-fetch to update targets server side
}

async function handleReset() {
    if (!confirm(`Are you SURE you want to permanently delete all data for ${currentUser}?`)) return;

    try {
        const response = await fetch(`/api/reset?user=${encodeURIComponent(currentUser)}&pin=${encodeURIComponent(currentPin)}`, {
            method: 'POST'
        });
        if (response.ok) {
            showToast("Data wiped.");
            fetchData();
        } else {
            showToast("Auth Error", "error");
            showPinModal();
        }
    } catch (e) {
        showToast("Error wiping data", "error");
    }
}

async function fetchData() {
    try {
        const params = new URLSearchParams({ user: currentUser, pin: currentPin, goal: currentGoal });
        const response = await fetch(`/api/data?${params.toString()}`);

        if (response.status === 401) {
            currentPin = '';
            localStorage.removeItem('mf_pin');
            showPinModal();
            return;
        }

        const json = await response.json();
        rawData = json.data || [];

        // Update Stats in Header
        updateStats();

        // Render Charts
        renderCharts();
    } catch (error) {
        console.error("Error fetching data:", error);
        showToast("Error loading data", "error");
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const submitBtn = form.querySelector('button');
    const span = submitBtn.querySelector('span');
    const loader = submitBtn.querySelector('.loader');

    span.classList.add('hidden');
    loader.classList.remove('hidden');

    const data = {
        user: currentUser,
        pin: currentPin,
        goal: currentGoal,
        date: formData.get('date'),
        weight: parseFloat(formData.get('weight')),
        calories: parseInt(formData.get('calories')),
        protein: parseInt(formData.get('protein')) || 0,
        carbs: parseInt(formData.get('carbs')) || 0,
        fats: parseInt(formData.get('fats')) || 0
    };

    try {
        const response = await fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            showToast("Entry saved!");
            form.reset();
            // Refetch to get new trend logic
            await fetchData();
        } else {
            throw new Error("Failed to save");
        }
    } catch (error) {
        showToast(error.message, "error");
    } finally {
        span.classList.remove('hidden');
        loader.classList.add('hidden');
    }
}

function handleToggle(e) {
    timeToggles.forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    currentRange = e.target.dataset.range;
    renderCharts();
}

function filterData() {
    if (rawData.length === 0) return [];
    if (currentRange === 'all') return rawData;

    const days = parseInt(currentRange);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return rawData.filter(row => new Date(row.date) >= cutoffDate);
}

function updateStats() {
    const tdeeEl = document.getElementById('header-tdee');
    const trendEl = document.getElementById('header-trend');
    const targetEl = document.getElementById('header-target');

    if (rawData.length > 0) {
        const lastRow = rawData[rawData.length - 1];
        if (lastRow.estimated_tdee) tdeeEl.textContent = Math.round(lastRow.estimated_tdee);
        if (lastRow.trend_weight) trendEl.textContent = lastRow.trend_weight.toFixed(1) + 'kg';
        if (lastRow.target_calories) {
            targetEl.textContent = lastRow.target_calories;
        } else {
            targetEl.textContent = '--';
        }
    } else {
        tdeeEl.textContent = '--';
        trendEl.textContent = '--';
        targetEl.textContent = '--';
    }
}

function renderCharts() {
    const data = filterData();
    const dates = data.map(d => d.date);

    // Default chart options
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top',
                labels: { usePointStyle: true, boxWidth: 6, padding: 15 }
            },
            tooltip: {
                backgroundColor: 'rgba(15, 17, 21, 0.9)',
                titleFont: { size: 13, family: "'Outfit', sans-serif" },
                bodyFont: { size: 13, family: "'Outfit', sans-serif" },
                padding: 10,
                cornerRadius: 8,
                displayColors: true
            }
        },
        scales: {
            x: {
                type: 'time',
                time: { unit: currentRange === '14' || currentRange === '30' ? 'day' : 'month' },
                grid: { display: false },
                border: { display: false }
            },
            y: {
                grid: { color: colors.grid },
                border: { display: false }
            }
        },
        interaction: { mode: 'index', intersect: false }
    };

    // --- Weight Chart ---
    const weightCtx = document.getElementById('weightChart').getContext('2d');
    if (weightChartInstance) weightChartInstance.destroy();

    weightChartInstance = new Chart(weightCtx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'Trend Weight',
                    data: data.map(d => d.trend_weight),
                    borderColor: colors.trend,
                    backgroundColor: colors.trend,
                    borderWidth: 3,
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 6
                },
                {
                    label: 'Scale Weight',
                    data: data.map(d => d.weight),
                    borderColor: colors.weight,
                    backgroundColor: colors.weight,
                    borderWidth: 0,
                    pointRadius: 4,
                    pointBackgroundColor: colors.weight,
                    showLine: false
                }
            ]
        },
        options: commonOptions
    });

    // --- Macro Chart ---
    const macroCtx = document.getElementById('macroChart').getContext('2d');
    if (macroChartInstance) macroChartInstance.destroy();

    macroChartInstance = new Chart(macroCtx, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'Protein',
                    data: data.map(d => d.protein * 4), // Calories from protein
                    backgroundColor: colors.protein,
                    borderRadius: { topLeft: 0, topRight: 0, bottomLeft: 4, bottomRight: 4 }
                },
                {
                    label: 'Carbs',
                    data: data.map(d => d.carbs * 4), // Calories from carbs
                    backgroundColor: colors.carbs
                },
                {
                    label: 'Fats',
                    data: data.map(d => d.fats * 9), // Calories from fats
                    backgroundColor: colors.fats,
                    borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }
                }
            ]
        },
        options: {
            ...commonOptions,
            scales: {
                x: { ...commonOptions.scales.x, stacked: true },
                y: { ...commonOptions.scales.y, stacked: true }
            }
        }
    });
}

function showToast(message, type = "success") {
    toastEl.textContent = message;
    toastEl.className = `toast show ${type}`;

    setTimeout(() => {
        toastEl.classList.remove('show');
    }, 3000);
}

// Run init when DOM is ready
document.addEventListener('DOMContentLoaded', init);
