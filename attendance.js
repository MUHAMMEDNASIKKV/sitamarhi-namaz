// 🌐 Global Variables
let currentUser = null;
let currentPage = 'attendance';
let chartInstances = {};
let adminChartInstances = {};
let studentSubjectChartInstances = {};
let adminSubjectChartInstances = {};
let today = new Date().toISOString().split('T')[0];
let userCache = null;
let userCacheTime = 0;
const USER_CACHE_TIMEOUT = 60000; // 1 minute

// =============================
// 📊 Google Sheets Integration (OPTIMIZED)
// =============================
class GoogleSheetsAPI {
    constructor() {
        this.apiUrl = "https://script.google.com/macros/s/AKfycbxCi--o1iMHyLI5aY2NEEj0iEKjES0gPCMEWByqTU_0kgtSl5EmxFzFkM1nlAD4P8U8MA/exec";
        this.cache = new Map();
        this.pendingRequests = new Map(); // Prevent duplicate concurrent requests
        this.cacheTimeout = 60000; // 1 minute cache
        this.batchQueue = [];
        this.batchTimer = null;
    }

    // Batch multiple sheet requests into single API call
    async getSheets(sheetNames) {
        const results = {};
        const toFetch = [];
        
        // Check cache first
        sheetNames.forEach(name => {
            const cached = this.cache.get(name);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
                results[name] = cached.data;
            } else {
                toFetch.push(name);
            }
        });
        
        if (toFetch.length === 0) return results;
        
        // Fetch all uncached sheets in parallel
        const fetchPromises = toFetch.map(name => this.getSheet(name, false));
        const fetchedData = await Promise.allSettled(fetchPromises);
        
        fetchedData.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                results[toFetch[index]] = result.value;
            } else {
                results[toFetch[index]] = { error: result.reason?.message || 'Failed to fetch' };
            }
        });
        
        return results;
    }

    async getSheet(sheetName, useCache = true) {
        const cacheKey = sheetName;
        const now = Date.now();
        
        // Return cached data if valid
        if (useCache && this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (now - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }
        
        // Prevent duplicate concurrent requests
        if (this.pendingRequests.has(cacheKey)) {
            return this.pendingRequests.get(cacheKey);
        }
        
        const requestPromise = this._fetchSheet(sheetName, cacheKey, now, useCache);
        this.pendingRequests.set(cacheKey, requestPromise);
        
        try {
            const result = await requestPromise;
            return result;
        } finally {
            this.pendingRequests.delete(cacheKey);
        }
    }
    
    async _fetchSheet(sheetName, cacheKey, now, useCache) {
        try {
            const url = `${this.apiUrl}?sheet=${encodeURIComponent(sheetName)}&t=${now}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
            
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            const cacheData = { data, timestamp: now };
            if (useCache) {
                this.cache.set(cacheKey, cacheData);
            }
            
            return data;
        } catch (error) {
            console.error(`Error fetching ${sheetName}:`, error);
            return { error: error.message };
        }
    }

    clearCache() {
        this.cache.clear();
        this.pendingRequests.clear();
    }

    invalidateCache(pattern) {
        for (const key of this.cache.keys()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
            }
        }
    }

    async addBatchRows(sheetName, rowsArray) {
        try {
            const response = await fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    sheet: sheetName,
                    data: JSON.stringify(rowsArray),
                    batch: 'true'
                })
            });
            
            const result = await response.json();
            this.cache.delete(sheetName);
            
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }
}

const api = new GoogleSheetsAPI();

// =============================
// 👤 Profile Functions
// =============================
function toggleProfileMenu() {
    const profileMenu = document.getElementById('profileMenu');
    profileMenu.classList.toggle('hidden');
}

function showProfileFallback(img) {
    document.getElementById('profileFallback').classList.remove('hidden');
    img.style.display = 'none';
}

function loadUserProfile(username) {
    const profilePic = document.getElementById('profilePic');
    const profileFallback = document.getElementById('profileFallback');
    
    // Try PNG first, fallback to JPEG, then JPG
    const tryLoad = (ext) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(ext);
            img.onerror = () => resolve(null);
            img.src = `https://quaf.tech/pic/${username}.${ext}`;
        });
    };
    
    (async () => {
        const ext = await tryLoad('png') || await tryLoad('jpeg') || await tryLoad('jpg');
        if (ext) {
            profilePic.src = `https://quaf.tech/pic/${username}.${ext}`;
            profilePic.style.display = 'block';
            profileFallback.classList.add('hidden');
        } else {
            profileFallback.classList.remove('hidden');
            profilePic.style.display = 'none';
        }
    })();
    
    if (currentUser) {
        document.getElementById('profileName').textContent = currentUser.name;
        document.getElementById('profileUsername').textContent = `@${username}`;
    }
}

document.addEventListener('click', function(event) {
    const profileMenu = document.getElementById('profileMenu');
    if (!event.target.closest('.profile-pic-container') && !profileMenu.classList.contains('hidden')) {
        profileMenu.classList.add('hidden');
    }
});

// =============================
// 🔑 Authentication (OPTIMIZED)
// =============================
async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
        showError('Please enter both username and password');
        return;
    }

    const loginBtn = document.querySelector('#loginForm button[type="submit"]');
    const originalHTML = loginBtn.innerHTML;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing In...';
    loginBtn.disabled = true;

    try {
        // Use cached users if available
        const users = await api.getSheet("user_credentials", false);
        
        if (!Array.isArray(users)) {
            showError('Failed to fetch user data');
            return;
        }
        
        const user = users.find(u => u.username === username && u.password === password);

        if (user) {
            currentUser = {
                username: user.username,
                name: user.full_name || user.username,
                role: user.role || 'student',
                class: user.class || null,
                subjects: user.subjects || null,
                userId: user.username
            };

            document.getElementById('loginPage').classList.add('hidden');
            document.getElementById('dashboardContainer').classList.remove('hidden');
            document.getElementById('welcomeUser').textContent = `Welcome, ${currentUser.name}`;

            loadUserProfile(username);

            if (currentUser.role === 'admin') {
                document.getElementById('studentNav').classList.add('hidden');
                document.getElementById('adminNav').classList.remove('hidden');
                document.getElementById('attendanceDate').value = today;
                
                // Run both in parallel
                await Promise.all([
                    loadAdminData(),
                    showPage('adminAttendance')
                ]);
            } else {
                document.getElementById('studentNav').classList.remove('hidden');
                document.getElementById('adminNav').classList.add('hidden');
                
                // Run both in parallel
                await Promise.all([
                    loadAttendance(),
                    showPage('attendance')
                ]);
            }
            
            hideError();
        } else {
            showError('Invalid username or password');
        }
    } catch (error) {
        showError('Network error: ' + error.message);
    } finally {
        loginBtn.innerHTML = originalHTML;
        loginBtn.disabled = false;
    }
}

function showError(message) {
    const errorDiv = document.getElementById('loginError');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideError() {
    document.getElementById('loginError').classList.add('hidden');
}

function logout() {
    currentUser = null;
    api.clearCache();
    userCache = null;
    
    destroyAllCharts(chartInstances);
    destroyAllCharts(adminChartInstances);
    destroyAllCharts(studentSubjectChartInstances);
    destroyAllCharts(adminSubjectChartInstances);
    
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('dashboardContainer').classList.add('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    hideError();
    showLogin();
}

function destroyAllCharts(chartObj) {
    for (const key of Object.keys(chartObj)) {
        if (chartObj[key]?.destroy) {
            chartObj[key].destroy();
        }
        delete chartObj[key];
    }
}

// =============================
// 📍 Navigation (OPTIMIZED)
// =============================
async function showPage(page) {
    // Hide all pages
    const allPages = document.querySelectorAll('.page-content');
    allPages.forEach(p => p.classList.add('hidden'));
    
    // Reset all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active', 'border-green-500', 'text-green-600', 'border-blue-500', 'text-blue-600');
    });

    // Show target page
    const targetPage = document.getElementById(page + 'Page');
    if (targetPage) targetPage.classList.remove('hidden');
    
    // Set active nav
    const navMap = {
        'attendance': 'navAttendance',
        'status': 'navStatus',
        'adminAttendance': 'navAdminAttendance',
        'adminStatus': 'navAdminStatus'
    };
    
    const activeNavId = navMap[page];
    if (activeNavId) {
        const navBtn = document.getElementById(activeNavId);
        if (navBtn) {
            if (currentUser?.role === 'admin') {
                navBtn.classList.add('active', 'border-blue-500', 'text-blue-600');
            } else {
                navBtn.classList.add('active', 'border-green-500', 'text-green-600');
            }
        }
    }

    currentPage = page;

    // Load page-specific data
    switch(page) {
        case 'attendance':
            if (currentUser?.role === 'student') await loadAttendance();
            break;
        case 'status':
            await loadStatusCharts();
            break;
        case 'adminAttendance':
            await loadAdminData();
            break;
        case 'adminStatus':
            await loadAllUsersStatus();
            break;
    }
}

// =============================
// 📅 Student Attendance (OPTIMIZED - Parallel Loading)
// =============================
async function loadAttendance() {
    const container = document.getElementById('subjectAttendanceCards');
    container.innerHTML = generateSkeleton(3);

    try {
        if (!currentUser.class) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">No class assigned.</p>';
            document.getElementById('userClassAttendance').textContent = 'Class: Not Assigned';
            return;
        }
        
        document.getElementById('userClassAttendance').textContent = `Class ${currentUser.class}`;
        
        // Get subjects and fetch all attendance sheets in PARALLEL
        const subjects = await getStudentSubjects();
        
        if (!subjects || subjects.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">No subjects found.</p>';
            return;
        }
        
        // Create all sheet names
        const sheetNames = subjects.map(s => `attendance_${currentUser.class}_${s}`);
        
        // Fetch ALL sheets in parallel
        const allData = await api.getSheets(sheetNames);
        
        // Process data
        const attendanceBySubject = {};
        
        subjects.forEach((subject, index) => {
            const sheetName = sheetNames[index];
            const attendance = allData[sheetName];
            
            if (Array.isArray(attendance)) {
                const studentRecords = attendance.filter(r => 
                    r.username === currentUser.username
                );
                
                if (studentRecords.length > 0) {
                    attendanceBySubject[subject] = studentRecords.sort((a, b) => 
                        new Date(b.date) - new Date(a.date)
                    );
                }
            }
        });

        if (Object.keys(attendanceBySubject).length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">No attendance records found.</p>';
            return;
        }

        // Build HTML in one go using DocumentFragment
        const fragment = document.createDocumentFragment();

        Object.entries(attendanceBySubject).forEach(([subject, records]) => {
            const presentCount = records.filter(r => r.status === 'present').length;
            const totalCount = records.length;
            const percentage = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
            
            const safeSubject = subject.replace(/[^a-zA-Z0-9]/g, '_');
            
            const subjectCard = document.createElement('div');
            subjectCard.className = 'subject-card';
            subjectCard.innerHTML = `
                <div class="subject-header" onclick="toggleSubjectAttendance('${safeSubject}')">
                    <div class="flex items-center min-w-0 flex-1">
                        <div class="subject-icon">
                            <i class="${getSubjectIcon(subject)}"></i>
                        </div>
                        <div class="subject-info min-w-0 flex-1">
                            <h3>${subject}</h3>
                            <p>${presentCount}/${totalCount} present • ${percentage}% attendance</p>
                        </div>
                    </div>
                    <div class="flex items-center space-x-2 flex-shrink-0">
                        <span class="attendance-badge ${percentage >= 75 ? 'present-badge' : 'absent-badge'}">
                            ${percentage}%
                        </span>
                        <i class="fas fa-chevron-down expand-arrow" id="arrow-${safeSubject}"></i>
                    </div>
                </div>
                
                <div class="attendance-container" id="attendance-${safeSubject}">
                    ${records.map(record => `
                        <div class="attendance-record">
                            <div class="flex items-center justify-between">
                                <span class="date-badge">${formatDate(record.date)}</span>
                                <span class="${record.status === 'present' ? 'status-present' : 'status-absent'}">
                                    ${record.status === 'present' ? '✓ Present' : '✗ Absent'}
                                </span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
            fragment.appendChild(subjectCard);
        });

        container.innerHTML = '';
        container.appendChild(fragment);
        
    } catch (error) {
        console.error('Error loading attendance:', error);
        container.innerHTML = '<p class="text-red-500 text-center py-8">Error loading attendance.</p>';
    }
}

async function getStudentSubjects() {
    // Get subjects from admin's assignment
    if (currentUser.adminSubjects) {
        const allSubjects = new Set();
        for (const subjects of Object.values(currentUser.adminSubjects)) {
            subjects.forEach(s => allSubjects.add(s));
        }
        if (allSubjects.size > 0) return [...allSubjects];
    }
    
    // Fallback
    try {
        const users = await getCachedUsers();
        if (Array.isArray(users)) {
            const classUser = users.find(u => 
                u.role === 'student' && 
                u.subjects && 
                String(u.class) === String(currentUser.class)
            );
            if (classUser?.subjects) {
                return classUser.subjects.toString().split(',').map(s => s.trim().toLowerCase()).filter(s => s);
            }
        }
    } catch (e) {
        console.error('Error getting subjects:', e);
    }
    
    return getDefaultSubjects();
}

function getDefaultSubjects() {
    return ['quaf', 'arabic_wing', 'urdu_wing', 'english_wing', 'malayalam_wing', 
            'media_wing', 'sigma_wing', 'art_wing', 'oration_wing', 'gk_wing', 
            'himaya_wing', 'class', 'swalah'];
}

async function getCachedUsers() {
    const now = Date.now();
    if (userCache && (now - userCacheTime) < USER_CACHE_TIMEOUT) {
        return userCache;
    }
    userCache = await api.getSheet("user_credentials");
    userCacheTime = now;
    return userCache;
}

function toggleSubjectAttendance(subject) {
    const container = document.getElementById(`attendance-${subject}`);
    const arrow = document.getElementById(`arrow-${subject}`);
    
    if (!container || !arrow) return;
    
    // Close all other expanded containers
    document.querySelectorAll('.attendance-container.expanded').forEach(c => {
        if (c !== container) c.classList.remove('expanded');
    });
    document.querySelectorAll('.expand-arrow.expanded').forEach(a => {
        if (a !== arrow) a.classList.remove('expanded');
    });
    
    container.classList.toggle('expanded');
    arrow.classList.toggle('expanded');
}

// =============================
// 📊 Status Charts (OPTIMIZED - Instant Render)
// =============================
async function loadStatusCharts() {
    try {
        const subjects = await getStudentSubjects();
        
        // Fetch ALL attendance sheets in parallel
        const sheetNames = subjects.map(s => `attendance_${currentUser.class}_${s}`);
        const allData = await api.getSheets(sheetNames);
        
        // Process all attendance records
        let allAttendance = [];
        subjects.forEach((subject, index) => {
            const attendance = allData[sheetNames[index]];
            if (Array.isArray(attendance)) {
                const studentRecords = attendance.filter(r => 
                    r.username === currentUser.username
                );
                allAttendance = allAttendance.concat(studentRecords);
            }
        });
        
        // Render charts in parallel
        await Promise.all([
            renderOverallChart(allAttendance, 'overallAttendanceChart', 'overallStats', chartInstances, 'overallAttendance'),
            renderSubjectCharts(allAttendance, 'subjectPieCharts', studentSubjectChartInstances)
        ]);
    } catch (error) {
        console.error('Error loading status charts:', error);
    }
}

async function renderOverallChart(attendance, canvasId, statsId, chartsObj, chartKey) {
    const presentCount = Array.isArray(attendance) ? 
        attendance.filter(a => a.status === 'present').length : 0;
    const absentCount = Array.isArray(attendance) ? 
        attendance.filter(a => a.status === 'absent').length : 0;

    // Update stats immediately
    const statsContainer = document.getElementById(statsId);
    if (statsContainer) {
        statsContainer.innerHTML = `
            <div class="stats-card">
                <div class="stats-number">${presentCount}</div>
                <div class="stats-label">Present Days</div>
            </div>
            <div class="stats-card">
                <div class="stats-number red">${absentCount}</div>
                <div class="stats-label">Absent Days</div>
            </div>
        `;
    }

    // Render chart immediately (no setTimeout)
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    
    // Destroy existing chart
    if (chartsObj[chartKey]) {
        chartsObj[chartKey].destroy();
    }
    
    chartsObj[chartKey] = new Chart(ctx.getContext('2d'), {
        type: 'pie',
        data: {
            labels: ['Present', 'Absent'],
            datasets: [{
                data: [presentCount || 1, absentCount || 0], // Ensure at least 1 to show ring
                backgroundColor: ['#10b981', '#ef4444'],
                borderColor: ['#059669', '#dc2626'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 500 }, // Faster animation
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        font: { size: 14 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

async function renderSubjectCharts(attendance, containerId, chartsObj) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Destroy all existing charts
    destroyAllCharts(chartsObj);

    if (!Array.isArray(attendance) || attendance.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center col-span-full py-8">No attendance data</p>';
        return;
    }

    // Process subject stats
    const subjectStats = {};
    attendance.forEach(record => {
        const subject = record.subject || 'General';
        if (!subjectStats[subject]) {
            subjectStats[subject] = { present: 0, absent: 0 };
        }
        if (record.status === 'present') {
            subjectStats[subject].present++;
        } else {
            subjectStats[subject].absent++;
        }
    });

    const subjects = Object.keys(subjectStats);
    
    if (subjects.length === 0) {
        container.innerHTML = '<p class="text-gray-500 text-center col-span-full py-8">No data available</p>';
        return;
    }

    // Build HTML
    let html = '';
    const chartConfigs = [];
    
    subjects.forEach((subject, index) => {
        const stats = subjectStats[subject];
        const total = stats.present + stats.absent;
        const percentage = total > 0 ? Math.round((stats.present / total) * 100) : 0;
        const canvasId = `subj-${index}-${Date.now()}`;
        
        chartConfigs.push({ canvasId, stats });
        
        html += `
            <div class="bg-white rounded-lg p-4 border-2 border-gray-200">
                <div class="flex items-center justify-center mb-3">
                    <div class="w-8 h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center text-white mr-2">
                        <i class="${getSubjectIcon(subject)} text-sm"></i>
                    </div>
                    <h4 class="font-semibold text-gray-800">${subject}</h4>
                </div>
                <div class="chart-container-small mx-auto">
                    <canvas id="${canvasId}"></canvas>
                </div>
                <div class="text-center mt-3">
                    <span class="text-lg font-bold ${percentage >= 75 ? 'text-green-600' : 'text-red-600'}">${percentage}%</span>
                    <p class="text-xs text-gray-500">${stats.present}/${total} present</p>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    
    // Create all charts IMMEDIATELY (no setTimeout)
    chartConfigs.forEach(({ canvasId, stats }) => {
        const ctx = document.getElementById(canvasId);
        if (ctx) {
            chartsObj[canvasId] = new Chart(ctx.getContext('2d'), {
                type: 'pie',
                data: {
                    labels: ['Present', 'Absent'],
                    datasets: [{
                        data: [stats.present || 1, stats.absent || 0],
                        backgroundColor: ['#10b981', '#ef4444'],
                        borderColor: ['#059669', '#dc2626'],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 300 },
                    plugins: {
                        legend: { display: false }
                    }
                }
            });
        }
    });
}

// =============================
// 👨‍💼 Admin Functions (OPTIMIZED)
// =============================
async function loadAdminData() {
    try {
        if (currentUser.role !== 'admin') return;
        
        let adminClasses = [];
        let adminSubjects = {};
        
        if (currentUser.class) {
            adminClasses = currentUser.class.toString().trim()
                .split(/[,\s]+/)
                .map(c => c.trim())
                .filter(c => c && /^\d+$/.test(c));
        }
        
        if (currentUser.subjects && adminClasses.length > 0) {
            const subjectsStr = currentUser.subjects.toString().trim();
            const bracketMatches = subjectsStr.match(/\(\d+-[^)]+\)/g);
            
            if (bracketMatches) {
                bracketMatches.forEach(match => {
                    const [classNum, subjectsString] = match.slice(1, -1).split('-', 2);
                    if (classNum && subjectsString) {
                        const subjects = subjectsString.toLowerCase() === 'all' 
                            ? getDefaultSubjects()
                            : subjectsString.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
                        
                        if (subjects.length > 0 && adminClasses.includes(classNum.trim())) {
                            adminSubjects[classNum.trim()] = subjects;
                        }
                    }
                });
            } else {
                const subjects = subjectsStr.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
                adminClasses.forEach(classNum => {
                    adminSubjects[classNum] = [...subjects];
                });
            }
        }
        
        currentUser.adminClasses = adminClasses;
        currentUser.adminSubjects = adminSubjects;
        
        const teachingInfo = document.getElementById('teachingSubjectsAttendance');
        if (teachingInfo) {
            teachingInfo.textContent = adminClasses.length > 0 ? 
                `Classes: ${adminClasses.join(', ')}` : 'No classes or subjects assigned';
        }
        
        await populateAdminFilters();
    } catch (error) {
        console.error('Error loading admin data:', error);
    }
}

function populateAdminFilters() {
    const classSelect = document.getElementById('adminClassSelect');
    const subjectSelect = document.getElementById('adminSubjectSelect');
    
    if (!classSelect || !subjectSelect) return;
    
    let classHTML = '<option value="">-- Select Class --</option>';
    if (currentUser.adminClasses?.length > 0) {
        currentUser.adminClasses.forEach(classNum => {
            classHTML += `<option value="${classNum}">Class ${classNum}</option>`;
        });
    }
    classSelect.innerHTML = classHTML;
    
    subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';
    subjectSelect.disabled = true;
    
    // Use event delegation
    classSelect.onchange = handleAdminClassChange;
    subjectSelect.onchange = handleAdminSubjectChange;
}

function handleAdminClassChange() {
    const selectedClass = this.value;
    const subjectSelect = document.getElementById('adminSubjectSelect');
    
    if (selectedClass && currentUser.adminSubjects?.[selectedClass]) {
        let subjectHTML = '<option value="">-- Select Subject --</option>';
        currentUser.adminSubjects[selectedClass].forEach(subject => {
            subjectHTML += `<option value="${subject.toLowerCase()}">${subject.charAt(0).toUpperCase() + subject.slice(1)}</option>`;
        });
        subjectSelect.innerHTML = subjectHTML;
        subjectSelect.disabled = false;
    } else {
        subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';
        subjectSelect.disabled = true;
    }
    
    document.getElementById('adminAttendanceView').classList.add('hidden');
    document.getElementById('adminDefaultView').classList.remove('hidden');
}

async function handleAdminSubjectChange() {
    const selectedClass = document.getElementById('adminClassSelect').value;
    const selectedSubject = this.value;
    const selectedDate = document.getElementById('attendanceDate').value;
    
    if (selectedClass && selectedSubject && selectedDate) {
        await loadAdminAttendanceView(selectedClass, selectedSubject, selectedDate);
    }
}

async function loadAdminAttendanceView(classNum, subject, date) {
    try {
        document.getElementById('adminDefaultView').classList.add('hidden');
        document.getElementById('adminAttendanceView').classList.remove('hidden');
        
        document.getElementById('selectedAttendanceInfo').textContent = 
            `Class ${classNum} - ${subject.charAt(0).toUpperCase() + subject.slice(1)} - ${formatDate(date)}`;
        
        // Load existing attendance and users in PARALLEL
        const [existingAttendance, users] = await Promise.all([
            api.getSheet(`attendance_${classNum}_${subject}`),
            getCachedUsers()
        ]);
        
        // Build existing attendance map
        const existingMap = new Map();
        if (Array.isArray(existingAttendance)) {
            existingAttendance.forEach(record => {
                if (record.date === date) {
                    existingMap.set(record.username, record.status);
                }
            });
        }
        
        if (!Array.isArray(users)) {
            document.getElementById('adminStudentsList').innerHTML = 
                '<p class="text-red-500 text-center col-span-full">Error loading students.</p>';
            return;
        }
        
        // Filter students for this class
        const classStudents = users.filter(user => 
            user.role === 'student' && String(user.class) === String(classNum)
        );
        
        if (classStudents.length === 0) {
            document.getElementById('adminStudentsList').innerHTML = 
                `<p class="text-gray-500 text-center col-span-full">No students found in Class ${classNum}.</p>`;
            return;
        }
        
        // Build student cards HTML in one go
        const studentsHTML = classStudents.map(student => {
            const initials = student.full_name ? 
                student.full_name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
                student.username.substring(0, 2).toUpperCase();
            
            const existingStatus = existingMap.get(student.username);
            const isPresent = existingStatus ? existingStatus === 'present' : true;
            
            return `
                <div class="student-card ${isPresent ? 'selected' : ''}" id="student-card-${student.username}" onclick="toggleStudentSelection('${student.username}')">
                    <div class="student-avatar">${initials}</div>
                    <div class="student-name">${student.full_name || student.username}</div>
                    <div class="student-username">@${student.username}</div>
                    <div class="student-class">Class ${student.class}</div>
                    <div class="attendance-checkbox">
                        <input type="checkbox" 
                               id="check-${student.username}" 
                               ${isPresent ? 'checked' : ''} 
                               onclick="event.stopPropagation(); toggleStudentSelection('${student.username}')">
                        <label for="check-${student.username}">
                            ${isPresent ? 'Present' : 'Absent'}
                        </label>
                    </div>
                </div>
            `;
        }).join('');
        
        document.getElementById('adminStudentsList').innerHTML = studentsHTML;
        
    } catch (error) {
        console.error('Error loading admin attendance view:', error);
        document.getElementById('adminStudentsList').innerHTML = 
            '<p class="text-red-500 text-center col-span-full">Error loading data.</p>';
    }
}

function toggleStudentSelection(username) {
    const checkbox = document.getElementById(`check-${username}`);
    const card = document.getElementById(`student-card-${username}`);
    
    if (!checkbox || !card) return;
    
    checkbox.checked = !checkbox.checked;
    
    if (checkbox.checked) {
        card.classList.add('selected');
        checkbox.nextElementSibling.textContent = 'Present';
    } else {
        card.classList.remove('selected');
        checkbox.nextElementSibling.textContent = 'Absent';
    }
}

function selectAllStudents() {
    document.querySelectorAll('#adminStudentsList input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = true;
        checkbox.closest('.student-card')?.classList.add('selected');
        if (checkbox.nextElementSibling) checkbox.nextElementSibling.textContent = 'Present';
    });
}

function deselectAllStudents() {
    document.querySelectorAll('#adminStudentsList input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
        checkbox.closest('.student-card')?.classList.remove('selected');
        if (checkbox.nextElementSibling) checkbox.nextElementSibling.textContent = 'Absent';
    });
}

async function submitAttendance() {
    const selectedClass = document.getElementById('adminClassSelect').value;
    const selectedSubject = document.getElementById('adminSubjectSelect').value;
    const selectedDate = document.getElementById('attendanceDate').value;
    
    if (!selectedClass || !selectedSubject || !selectedDate) {
        alert('Please select class, subject, and date.');
        return;
    }
    
    const submitBtn = document.getElementById('submitAttendanceBtn');
    const originalHTML = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
    submitBtn.disabled = true;
    
    try {
        const checkboxes = document.querySelectorAll('#adminStudentsList input[type="checkbox"]');
        const attendanceRows = [];
        
        checkboxes.forEach(checkbox => {
            const username = checkbox.id.replace('check-', '');
            const status = checkbox.checked ? 'present' : 'absent';
            attendanceRows.push([selectedDate, username, status, selectedSubject]);
        });
        
        // Save to subject-based sheet
        const attendanceSheet = `attendance_${selectedClass}_${selectedSubject}`;
        await api.addBatchRows(attendanceSheet, attendanceRows);
        
        // Invalidate cache for this specific sheet and related status pages
        api.invalidateCache(`attendance_${selectedClass}_${selectedSubject}`);
        api.invalidateCache('user_credentials'); // Refresh user cache
        
        alert(`Attendance saved successfully for ${attendanceRows.length} students!`);
        
        // Reset view
        document.getElementById('adminAttendanceView').classList.add('hidden');
        document.getElementById('adminDefaultView').classList.remove('hidden');
        
    } catch (error) {
        console.error('Error submitting attendance:', error);
        alert('Error saving attendance: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
    }
}

function clearAdminFilters() {
    document.getElementById('adminClassSelect').value = '';
    document.getElementById('adminSubjectSelect').innerHTML = '<option value="">-- Select Subject --</option>';
    document.getElementById('adminSubjectSelect').disabled = true;
    document.getElementById('adminAttendanceView').classList.add('hidden');
    document.getElementById('adminDefaultView').classList.remove('hidden');
}

// =============================
// 👨‍💼 Admin Status Functions (OPTIMIZED)
// =============================
async function loadAllUsersStatus() {
    try {
        const userSelect = document.getElementById('userSelect');
        
        userSelect.innerHTML = '<option value="">-- Loading... --</option>';
        
        const users = await getCachedUsers();
        
        let userHTML = '<option value="">-- Select User --</option>';
        if (Array.isArray(users)) {
            const students = users.filter(user => user.role === 'student');
            students.forEach(student => {
                userHTML += `<option value="${student.username}">${student.full_name || student.username} (Class ${student.class || 'N/A'})</option>`;
            });
        }
        userSelect.innerHTML = userHTML;
        
        // Attach change handler
        userSelect.onchange = async function() {
            const selectedUsername = this.value;
            const noUserSelected = document.getElementById('noUserSelected');
            const selectedUserStatus = document.getElementById('selectedUserStatus');
            
            if (selectedUsername) {
                noUserSelected.classList.add('hidden');
                selectedUserStatus.classList.remove('hidden');
                await loadSelectedUserStatus(selectedUsername);
            } else {
                noUserSelected.classList.remove('hidden');
                selectedUserStatus.classList.add('hidden');
            }
        };
        
        document.getElementById('noUserSelected').classList.remove('hidden');
        document.getElementById('selectedUserStatus').classList.add('hidden');
        
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

async function loadSelectedUserStatus(username) {
    try {
        destroyAllCharts(adminChartInstances);
        destroyAllCharts(adminSubjectChartInstances);
        
        const users = await getCachedUsers();
        const user = users.find(u => u.username === username);
        
        if (!user) {
            alert('User not found!');
            return;
        }
        
        document.getElementById('selectedUserName').textContent = user.full_name || user.username;
        document.getElementById('selectedUserInfo').textContent = 
            `Username: ${user.username} | Class: ${user.class || 'N/A'} | Role: ${user.role}`;
        
        // Get subjects and fetch attendance in PARALLEL
        const subjects = await getUserSubjects(user);
        const sheetNames = subjects.map(s => `attendance_${user.class}_${s}`);
        const allData = await api.getSheets(sheetNames);
        
        let allAttendance = [];
        subjects.forEach((subject, index) => {
            const attendance = allData[sheetNames[index]];
            if (Array.isArray(attendance)) {
                const studentRecords = attendance.filter(r => r.username === username);
                allAttendance = allAttendance.concat(studentRecords);
            }
        });
        
        // Render charts in parallel
        await Promise.all([
            renderOverallChart(allAttendance, 'adminOverallAttendanceChart', 'adminOverallStats', adminChartInstances, 'overallAttendance'),
            renderSubjectCharts(allAttendance, 'adminSubjectPieCharts', adminSubjectChartInstances)
        ]);
        
    } catch (error) {
        console.error('Error loading user status:', error);
    }
}

async function getUserSubjects(user) {
    if (user.subjects) {
        const subjectsStr = user.subjects.toString().trim();
        const bracketMatch = subjectsStr.match(/\(\d+-([^)]+)\)/);
        if (bracketMatch) {
            const subjects = bracketMatch[1].toLowerCase();
            if (subjects === 'all') return getDefaultSubjects();
            return subjects.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
        }
        return subjectsStr.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
    }
    
    if (currentUser.adminSubjects && user.class) {
        return currentUser.adminSubjects[user.class] || getDefaultSubjects();
    }
    
    return getDefaultSubjects();
}

// =============================
// 🔐 Change Password Functions
// =============================
function openChangePasswordModal() {
    document.getElementById('profileMenu').classList.add('hidden');
    const modal = document.getElementById('changePasswordModal');
    modal.classList.remove('hidden');
    document.getElementById('changePasswordForm').reset();
    document.getElementById('changePasswordError').classList.add('hidden');
    document.getElementById('changePasswordSuccess').classList.add('hidden');
}

function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.add('hidden');
}

async function changePassword(event) {
    event.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value.trim();
    const newPassword = document.getElementById('newPassword').value.trim();
    const confirmPassword = document.getElementById('confirmPassword').value.trim();
    
    const errorDiv = document.getElementById('changePasswordError');
    const successDiv = document.getElementById('changePasswordSuccess');
    const submitBtn = event.target.querySelector('button[type="submit"]');
    
    errorDiv.classList.add('hidden');
    successDiv.classList.add('hidden');
    
    if (!currentPassword || !newPassword || !confirmPassword) {
        showChangePasswordError('Please fill in all fields');
        return;
    }
    
    if (newPassword.length < 6) {
        showChangePasswordError('New password must be at least 6 characters');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showChangePasswordError('New passwords do not match');
        return;
    }
    
    const originalHTML = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Changing...';
    submitBtn.disabled = true;
    
    try {
        const users = await api.getSheet("user_credentials", false);
        
        if (!Array.isArray(users)) {
            throw new Error('Failed to fetch user data');
        }
        
        const user = users.find(u => 
            String(u.username).toLowerCase().trim() === String(currentUser.username).toLowerCase().trim() && 
            String(u.password).trim() === String(currentPassword).trim()
        );
        
        if (!user) {
            throw new Error('Current password is incorrect');
        }
        
        const updateResult = await api.addBatchRows("password_updates", 
            [[currentUser.username, newPassword, 'password_update', new Date().toISOString()]]
        );
        
        if (updateResult?.success) {
            showChangePasswordSuccess('Password changed! Logging out in 3 seconds...');
            setTimeout(() => {
                closeChangePasswordModal();
                logout();
            }, 3000);
        } else {
            throw new Error(updateResult?.error || 'Failed to update password');
        }
        
    } catch (error) {
        showChangePasswordError(error.message);
    } finally {
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
    }
}

function showChangePasswordError(message) {
    const errorDiv = document.getElementById('changePasswordError');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function showChangePasswordSuccess(message) {
    const successDiv = document.getElementById('changePasswordSuccess');
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
}

// =============================
// 🔧 Utility Functions
// =============================
function getSubjectIcon(subject) {
    const icons = {
        'quaf': 'fas fa-scroll',
        'arabic_wing': 'fas fa-language',
        'arabic': 'fas fa-language',
        'urdu_wing': 'fas fa-language',
        'urdu': 'fas fa-language',
        'english_wing': 'fas fa-language',
        'english': 'fas fa-language',
        'malayalam_wing': 'fas fa-language',
        'malayalam': 'fas fa-language',
        'media_wing': 'fas fa-video',
        'media': 'fas fa-video',
        'sigma_wing': 'fas fa-brain',
        'sigma': 'fas fa-brain',
        'art_wing': 'fas fa-palette',
        'art': 'fas fa-palette',
        'oration_wing': 'fas fa-microphone',
        'oration': 'fas fa-microphone',
        'gk_wing': 'fas fa-globe',
        'gk': 'fas fa-globe',
        'himaya_wing': 'fas fa-shield-alt',
        'himaya': 'fas fa-shield-alt',
        'class': 'fas fa-chalkboard',
        'swalah': 'fas fa-pray'
    };
    return icons[subject.toLowerCase()] || 'fas fa-book';
}

const dateFormatCache = new Map();

function formatDate(dateString) {
    if (dateFormatCache.has(dateString)) return dateFormatCache.get(dateString);
    
    try {
        const date = new Date(dateString);
        const formatted = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
        dateFormatCache.set(dateString, formatted);
        return formatted;
    } catch {
        return dateString;
    }
}

function generateSkeleton(count) {
    return `
        <div class="animate-pulse space-y-4">
            ${Array(count).fill(0).map(() => `
                <div class="bg-white rounded-lg p-4 border-2 border-gray-200">
                    <div class="flex items-center space-x-3">
                        <div class="w-10 h-10 bg-gray-200 rounded-full"></div>
                        <div class="flex-1">
                            <div class="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                            <div class="h-3 bg-gray-200 rounded w-1/2"></div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// =============================
// 🎯 Event Listeners & Initialization
// =============================
document.addEventListener('DOMContentLoaded', function() {
    // Use event delegation for form submissions
    document.getElementById('signupForm').onsubmit = function(e) {
        e.preventDefault();
        submitSignup();
    };
    
    document.getElementById('loginForm').onsubmit = function(e) {
        e.preventDefault();
        login();
    };
    
    document.getElementById('changePasswordForm').onsubmit = changePassword;
    
    document.getElementById('changePasswordModal').onclick = function(e) {
        if (e.target === this) closeChangePasswordModal();
    };
    
    document.getElementById('attendanceDate').value = today;
    document.getElementById('attendanceDate').onchange = function() {
        const selectedClass = document.getElementById('adminClassSelect').value;
        const selectedSubject = document.getElementById('adminSubjectSelect').value;
        if (selectedClass && selectedSubject) {
            loadAdminAttendanceView(selectedClass, selectedSubject, this.value);
        }
    };

    // Initialize signup section
    initializeSignup();
});

// Signup functions
function showSignup() {
    document.getElementById('loginSection').classList.add('hidden');
    document.getElementById('signupSection').classList.remove('hidden');
    hideError();
}

function showLogin() {
    document.getElementById('signupSection').classList.add('hidden');
    document.getElementById('loginSection').classList.remove('hidden');
    hideSignupError();
    hideSignupSuccess();
}

function showSignupError(message) {
    const errorDiv = document.getElementById('signupError');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideSignupError() {
    document.getElementById('signupError').classList.add('hidden');
}

function showSignupSuccess(message) {
    const successDiv = document.getElementById('signupSuccess');
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
}

function hideSignupSuccess() {
    document.getElementById('signupSuccess').classList.add('hidden');
}

async function submitSignup() {
    const fields = ['signupName', 'signupPhone', 'signupState', 'signupDistrict', 'signupPlace', 'signupPO', 'signupPinCode'];
    const values = {};
    
    fields.forEach(id => {
        values[id] = document.getElementById(id).value.trim();
    });
    
    const gmail = document.getElementById('signupGmail').value.trim();
    
    if (!values.signupName || !values.signupPhone || !values.signupState || 
        !values.signupDistrict || !values.signupPlace || !values.signupPO || !values.signupPinCode) {
        showSignupError('Please fill in all required fields');
        return;
    }
    
    if (!/^\d{6}$/.test(values.signupPinCode)) {
        showSignupError('Please enter a valid 6-digit pin code');
        return;
    }

    const signupBtn = document.querySelector('#signupForm button[type="submit"]');
    const originalHTML = signupBtn.innerHTML;
    signupBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating...';
    signupBtn.disabled = true;

    try {
        const rowData = [
            values.signupName,
            values.signupPhone,
            gmail || '',
            values.signupState,
            values.signupDistrict,
            values.signupPlace,
            values.signupPO,
            values.signupPinCode,
            new Date().toISOString().split('T')[0]
        ];

        const result = await api.addBatchRows('registration', [rowData]);

        if (result?.success) {
            showSignupSuccess('Account created! Contact admin for login credentials.');
            document.getElementById('signupForm').reset();
            hideSignupError();
        } else {
            throw new Error(result?.error || 'Unknown error');
        }
    } catch (error) {
        showSignupError('Registration failed: ' + error.message);
    } finally {
        signupBtn.innerHTML = originalHTML;
        signupBtn.disabled = false;
    }
}

function initializeSignup() {
    showLogin();
}

// Debounced resize handler
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const allCharts = {
            ...chartInstances,
            ...adminChartInstances,
            ...studentSubjectChartInstances,
            ...adminSubjectChartInstances
        };
        for (const chart of Object.values(allCharts)) {
            chart?.resize?.();
        }
    }, 250);
});

// Security - prevent dev tools
document.addEventListener("contextmenu", e => e.preventDefault());
document.addEventListener("keydown", e => {
    if (e.key === "F12") e.preventDefault();
    if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) e.preventDefault();
    if (e.ctrlKey && (e.key === "u" || e.key === "U" || e.key === "s" || e.key === "S")) e.preventDefault();
});

// Initialize app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

function initializeApp() {
    console.log('%c🚀 QUAF Attendance System v2.0 - Optimized', 'color: #059669; font-size: 16px; font-weight: bold;');
    console.log('%c⚡ Parallel API calls | Smart caching | Instant chart rendering', 'color: #1e40af; font-size: 12px;');
    showLogin();
}
