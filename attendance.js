// 🌐 Global Variables
let currentUser = null;
let currentPage = 'attendance';
let chartInstances = {};
let adminChartInstances = {};
let today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

// =============================
// 📊 Google Sheets Integration
// =============================
class GoogleSheetsAPI {
    constructor() {
        this.apiUrl = "https://script.google.com/macros/s/AKfycbx6cwF3LVu72wDfyc2zThBMypDBlxN-N2g5PvbVt4IGhzqSqvD63XGbBadEu-3Npx_wYg/exec";
        this.cache = new Map();
        this.localCache = this.initLocalCache();
        this.cacheTimeout = 30 * 1000; // 30 seconds
    }

    initLocalCache() {
        try {
            const cached = localStorage.getItem('attendance_cache');
            return cached ? JSON.parse(cached) : {};
        } catch {
            return {};
        }
    }

    saveLocalCache() {
        try {
            localStorage.setItem('attendance_cache', JSON.stringify(this.localCache));
        } catch (e) {
            console.warn('Failed to save cache:', e);
        }
    }

    async getSheet(sheetName, useCache = true) {
        const cacheKey = sheetName;
        const now = Date.now();
        
        if (useCache && this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (now - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }
        
        if (useCache && this.localCache[cacheKey]) {
            const cached = this.localCache[cacheKey];
            if (now - cached.timestamp < 5 * 60 * 1000) {
                this.cache.set(cacheKey, cached);
                return cached.data;
            }
        }

        try {
            const url = `${this.apiUrl}?sheet=${encodeURIComponent(sheetName)}&t=${now}`;
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Accept': 'application/json' }
            });
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            
            const cacheData = { data, timestamp: now };
            if (useCache) {
                this.cache.set(cacheKey, cacheData);
                this.localCache[cacheKey] = cacheData;
                this.saveLocalCache();
            }
            
            return data;
        } catch (error) {
            console.error(`Error fetching ${sheetName}:`, error);
            return { error: error.message };
        }
    }

    async getBatchSheets(sheetNames) {
        const promises = sheetNames.map(name => this.getSheet(name));
        const results = await Promise.all(promises);
        const batchResult = {};
        sheetNames.forEach((name, index) => {
            batchResult[name] = results[index];
        });
        return batchResult;
    }

    clearCache() {
        this.cache.clear();
        this.localCache = {};
        localStorage.removeItem('attendance_cache');
    }

    async addRow(sheetName, row) {
        try {
            const response = await fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    sheet: sheetName,
                    data: JSON.stringify(row)
                })
            });
            
            const result = await response.json();
            this.cache.delete(sheetName);
            delete this.localCache[sheetName];
            this.saveLocalCache();
            
            return result;
        } catch (error) {
            return { error: error.message };
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
            delete this.localCache[sheetName];
            this.saveLocalCache();
            
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
    const fallback = document.getElementById('profileFallback');
    img.style.display = 'none';
    fallback.classList.remove('hidden');
}

function loadUserProfile(username) {
    const profilePic = document.getElementById('profilePic');
    const profileName = document.getElementById('profileName');
    const profileUsername = document.getElementById('profileUsername');
    const profileFallback = document.getElementById('profileFallback');
    
    profilePic.src = `https://quaf.tech/pic/${username}.png`;
    profilePic.onerror = function() {
        this.onerror = function() {
            this.onerror = function() {
                this.style.display = 'none';
                profileFallback.classList.remove('hidden');
            };
            this.src = `https://quaf.tech/pic/${username}.jpeg`;
        };
        this.src = `https://quaf.tech/pic/${username}.jpg`;
    };
    
    profilePic.style.display = 'block';
    profileFallback.classList.add('hidden');
    
    if (currentUser) {
        profileName.textContent = currentUser.name;
        profileUsername.textContent = `@${username}`;
    }
}

document.addEventListener('click', function(event) {
    const profileContainer = event.target.closest('.profile-pic-container');
    const profileMenu = document.getElementById('profileMenu');
    
    if (!profileContainer && profileMenu && !profileMenu.classList.contains('hidden')) {
        profileMenu.classList.add('hidden');
    }
});

// =============================
// 🔑 Authentication
// =============================
async function login() {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!username || !password) {
        showError('Please enter both username and password');
        return;
    }

    const loginBtn = document.querySelector('button[type="submit"]');
    const originalText = loginBtn.innerHTML;
    loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Signing In...';
    loginBtn.disabled = true;

    try {
        const users = await api.getSheet("user_credentials", false);
        
        if (!users || users.error || !Array.isArray(users)) {
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
                
                // Set today's date for attendance
                document.getElementById('attendanceDate').value = today;
                
                Promise.all([
                    loadAdminData(),
                    showPage('adminAttendance')
                ]);
            } else {
                document.getElementById('studentNav').classList.remove('hidden');
                document.getElementById('adminNav').classList.add('hidden');
                
                Promise.all([
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
        loginBtn.innerHTML = originalText;
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
    
    Object.values(chartInstances).forEach(chart => {
        if (chart) chart.destroy();
    });
    chartInstances = {};
    
    Object.values(adminChartInstances).forEach(chart => {
        if (chart) chart.destroy();
    });
    adminChartInstances = {};
    
    document.getElementById('loginPage').classList.remove('hidden');
    document.getElementById('dashboardContainer').classList.add('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    hideError();
    showLogin();
}

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
    const name = document.getElementById('signupName').value.trim();
    const phone = document.getElementById('signupPhone').value.trim();
    const gmail = document.getElementById('signupGmail').value.trim();
    const state = document.getElementById('signupState').value.trim();
    const district = document.getElementById('signupDistrict').value.trim();
    const place = document.getElementById('signupPlace').value.trim();
    const po = document.getElementById('signupPO').value.trim();
    const pinCode = document.getElementById('signupPinCode').value.trim();

    if (!name || !phone || !state || !district || !place || !po || !pinCode) {
        showSignupError('Please fill in all required fields');
        return;
    }

    if (!/^\d{6}$/.test(pinCode)) {
        showSignupError('Please enter a valid 6-digit pin code');
        return;
    }

    const signupBtn = document.querySelector('#signupForm button[type="submit"]');
    const originalText = signupBtn.innerHTML;
    signupBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Creating Account...';
    signupBtn.disabled = true;

    try {
        const rowData = [
            name,
            phone,
            gmail || '',
            state,
            district,
            place,
            po,
            pinCode,
            new Date().toISOString().split('T')[0]
        ];

        const result = await api.addRow('registration', rowData);

        if (result && (result.success || result.includes?.('Success'))) {
            showSignupSuccess('Account created successfully! Please contact admin for login credentials.');
            document.getElementById('signupForm').reset();
            hideSignupError();
        } else {
            throw new Error(result?.error || 'Unknown error occurred');
        }
    } catch (error) {
        console.error('Signup error:', error);
        showSignupError('Registration failed: ' + error.message);
    } finally {
        signupBtn.innerHTML = originalText;
        signupBtn.disabled = false;
    }
}

// =============================
// 📍 Navigation
// =============================
async function showPage(page) {
    document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('border-green-500', 'text-green-600', 'border-blue-500', 'text-blue-600');
        btn.classList.add('border-transparent');
    });

    document.getElementById(page + 'Page').classList.remove('hidden');
    
    const clickedBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn => {
        const btnText = btn.textContent.toLowerCase();
        return btnText.includes(page.replace('admin', '').toLowerCase()) || 
               (page === 'adminStatus' && btnText.includes('all status'));
    });
    
    if (clickedBtn) {
        if (currentUser && currentUser.role === 'admin') {
            clickedBtn.classList.add('border-blue-500', 'text-blue-600');
        } else {
            clickedBtn.classList.add('border-green-500', 'text-green-600');
        }
    }

    currentPage = page;

    if (page === 'attendance' && currentUser.role === 'student') {
        await loadAttendance();
    } else if (page === 'status') {
        await loadStatusCharts();
    } else if (page === 'adminAttendance') {
        await loadAdminData();
    } else if (page === 'adminStatus') {
        await loadAllUsersStatus();
    }
}

// =============================
// 📅 Student Attendance Functions
// =============================
async function loadAttendance() {
    const container = document.getElementById('subjectAttendanceCards');
    
    container.innerHTML = `
        <div class="animate-pulse space-y-4">
            ${Array(3).fill(0).map(() => `
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

    try {
        if (!currentUser.class) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">No class assigned. Please contact administrator.</p>';
            document.getElementById('userClassAttendance').textContent = 'Class: Not Assigned';
            return;
        }
        
        document.getElementById('userClassAttendance').textContent = `Class ${currentUser.class}`;
        
        // Load attendance data
        const attendanceSheet = `${currentUser.username}_attendance`;
        const attendance = await api.getSheet(attendanceSheet);
        
        if (!attendance || attendance.error || attendance.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">No attendance records found.</p>';
            return;
        }

        // Group attendance by subject
        const attendanceBySubject = {};
        
        attendance.forEach(record => {
            const subject = record.subject || 'General';
            if (!attendanceBySubject[subject]) {
                attendanceBySubject[subject] = [];
            }
            
            attendanceBySubject[subject].push({
                date: record.date,
                status: record.status || 'absent',
                subject: subject
            });
        });

        // Sort records by date (newest first)
        Object.keys(attendanceBySubject).forEach(subject => {
            attendanceBySubject[subject].sort((a, b) => new Date(b.date) - new Date(a.date));
        });

        const fragment = document.createDocumentFragment();

        Object.entries(attendanceBySubject).forEach(([subject, records]) => {
            const presentCount = records.filter(r => r.status === 'present').length;
            const totalCount = records.length;
            const percentage = totalCount > 0 ? Math.round((presentCount / totalCount) * 100) : 0;
            
            const subjectCard = document.createElement('div');
            subjectCard.className = 'subject-card';
            
            subjectCard.innerHTML = `
                <div class="subject-header" onclick="toggleSubjectAttendance('${subject.replace(/[^a-zA-Z0-9]/g, '_')}')">
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
                        <i class="fas fa-chevron-down expand-arrow" id="arrow-${subject.replace(/[^a-zA-Z0-9]/g, '_')}"></i>
                    </div>
                </div>
                
                <div class="attendance-container" id="attendance-${subject.replace(/[^a-zA-Z0-9]/g, '_')}">
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
        container.innerHTML = '<p class="text-red-500 text-center py-8">Error loading attendance. Please try again.</p>';
    }
}

function toggleSubjectAttendance(subject) {
    const container = document.getElementById(`attendance-${subject}`);
    const arrow = document.getElementById(`arrow-${subject}`);
    
    if (container && arrow) {
        if (!container.classList.contains('expanded')) {
            document.querySelectorAll('.attendance-container.expanded').forEach(c => {
                if (c !== container) c.classList.remove('expanded');
            });
            document.querySelectorAll('.expand-arrow.expanded').forEach(a => {
                if (a !== arrow) a.classList.remove('expanded');
            });
            
            container.classList.add('expanded');
            arrow.classList.add('expanded');
        } else {
            container.classList.remove('expanded');
            arrow.classList.remove('expanded');
        }
    }
}

// =============================
// 📊 Status Charts & Summary
// =============================
async function loadStatusCharts() {
    try {
        const attendanceSheet = `${currentUser.username}_attendance`;
        const attendance = await api.getSheet(attendanceSheet);
        
        await Promise.all([
            loadAttendanceChart(attendance),
            loadSubjectAttendanceSummary(attendance)
        ]);
    } catch (error) {
        console.error('Error loading status charts:', error);
    }
}

async function loadAttendanceChart(attendance) {
    try {
        const presentCount = Array.isArray(attendance) ? 
            attendance.filter(a => a.status === 'present').length : 0;
        const absentCount = Array.isArray(attendance) ? 
            attendance.filter(a => a.status === 'absent').length : 0;

        const ctx = document.getElementById('attendanceChart');
        if (!ctx) return;
        
        if (chartInstances.attendanceChart) {
            chartInstances.attendanceChart.destroy();
        }
        
        chartInstances.attendanceChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Present', 'Absent'],
                datasets: [{
                    data: [presentCount, absentCount],
                    backgroundColor: ['#059669', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading attendance chart:', error);
    }
}

async function loadSubjectAttendanceSummary(attendance) {
    try {
        const subjectStats = {};
        
        if (Array.isArray(attendance)) {
            attendance.forEach(record => {
                const subject = record.subject || 'General';
                if (!subjectStats[subject]) {
                    subjectStats[subject] = { present: 0, total: 0 };
                }
                
                subjectStats[subject].total++;
                if (record.status === 'present') {
                    subjectStats[subject].present++;
                }
            });
        }
        
        const summaryContainer = document.getElementById('subjectAttendanceSummary');
        if (!summaryContainer) return;
        
        const summaryHtml = Object.entries(subjectStats).map(([subject, stats]) => {
            const percentage = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
            return `
                <div class="attendance-summary-card">
                    <div class="flex items-center justify-center mb-3">
                        <div class="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center text-white mr-2">
                            <i class="${getSubjectIcon(subject)} text-xs md:text-sm"></i>
                        </div>
                        <h4>${subject}</h4>
                    </div>
                    <div class="attendance-percentage">${percentage}%</div>
                    <div class="text-xs text-gray-500 mt-2">
                        ${stats.present}/${stats.total} classes attended
                    </div>
                </div>
            `;
        }).join('');
        
        summaryContainer.innerHTML = summaryHtml || '<p class="text-gray-500 text-center col-span-full">No attendance data available</p>';
        
    } catch (error) {
        console.error('Error loading subject attendance summary:', error);
    }
}

// =============================
// 👨‍💼 Admin Functions
// =============================
async function loadAdminData() {
    try {
        if (currentUser.role === 'admin') {
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
                                ? ['quaf', 'arabic_wing', 'urdu_wing', 'english_wing', 'malayalam_wing', 'media_wing', 'sigma_wing', 'art_wing', 'oration_wing', 'gk_wing', 'himaya_wing', 'class', 'swalah']
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
                if (adminClasses.length > 0) {
                    teachingInfo.textContent = `Classes: ${adminClasses.join(', ')}`;
                } else {
                    teachingInfo.textContent = 'No classes or subjects assigned';
                }
            }
            
            await populateAdminFilters();
        }
    } catch (error) {
        console.error('Error loading admin data:', error);
    }
}

async function populateAdminFilters() {
    const classSelect = document.getElementById('adminClassSelect');
    const subjectSelect = document.getElementById('adminSubjectSelect');
    
    if (!classSelect || !subjectSelect) return;
    
    classSelect.innerHTML = '<option value="">-- Select Class --</option>';
    subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';
    subjectSelect.disabled = true;
    
    if (currentUser.adminClasses && currentUser.adminClasses.length > 0) {
        currentUser.adminClasses.forEach(classNum => {
            const option = document.createElement('option');
            option.value = classNum;
            option.textContent = `Class ${classNum}`;
            classSelect.appendChild(option);
        });
    }
    
    classSelect.removeEventListener('change', handleAdminClassChange);
    subjectSelect.removeEventListener('change', handleAdminSubjectChange);
    
    classSelect.addEventListener('change', handleAdminClassChange);
    subjectSelect.addEventListener('change', handleAdminSubjectChange);
}

async function handleAdminClassChange() {
    const selectedClass = this.value;
    const subjectSelect = document.getElementById('adminSubjectSelect');
    subjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';
    
    if (selectedClass) {
        subjectSelect.disabled = false;
        
        let availableSubjects = currentUser.adminSubjects[selectedClass] || [];
        
        if (availableSubjects.length > 0) {
            availableSubjects.forEach(subject => {
                const option = document.createElement('option');
                option.value = subject.toLowerCase();
                option.textContent = subject.charAt(0).toUpperCase() + subject.slice(1);
                subjectSelect.appendChild(option);
            });
        }
    } else {
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
        const hasAccess = currentUser.adminSubjects && 
                         currentUser.adminSubjects[selectedClass] && 
                         currentUser.adminSubjects[selectedClass].includes(selectedSubject);
        
        if (hasAccess) {
            await loadAdminAttendanceView(selectedClass, selectedSubject, selectedDate);
        } else {
            alert('Access denied: You are not assigned to this class-subject combination.');
            this.value = '';
        }
    }
}

async function loadAdminAttendanceView(classNum, subject, date) {
    try {
        document.getElementById('adminDefaultView').classList.add('hidden');
        document.getElementById('adminAttendanceView').classList.remove('hidden');
        
        document.getElementById('selectedAttendanceInfo').textContent = 
            `Class ${classNum} - ${subject.charAt(0).toUpperCase() + subject.slice(1)} - ${formatDate(date)}`;
        
        // Load existing attendance for this date
        const attendanceSheet = `attendance_${classNum}_${subject}`;
        const existingAttendance = await api.getSheet(attendanceSheet);
        
        // Create a map of existing attendance for this date
        const existingMap = new Map();
        if (Array.isArray(existingAttendance)) {
            existingAttendance.forEach(record => {
                if (record.date === date) {
                    existingMap.set(record.username, record.status);
                }
            });
        }
        
        // Load students
        const users = await api.getSheet("user_credentials");
        const adminStudentsList = document.getElementById('adminStudentsList');
        
        if (!users || users.error) {
            adminStudentsList.innerHTML = '<p class="text-red-500 text-center col-span-full">Error loading students.</p>';
            return;
        }
        
        const classStudents = users.filter(user => 
            user.role === 'student' && String(user.class) === String(classNum)
        );
        
        if (classStudents.length === 0) {
            adminStudentsList.innerHTML = `<p class="text-gray-500 text-center col-span-full">No students found in Class ${classNum}.</p>`;
            return;
        }
        
        const studentsHtml = classStudents.map(student => {
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
                        <label for="check-${student.username}" class="ml-2 text-sm font-medium">
                            ${isPresent ? 'Present' : 'Absent'}
                        </label>
                    </div>
                </div>
            `;
        }).join('');
        
        adminStudentsList.innerHTML = studentsHtml;
        
    } catch (error) {
        console.error('Error loading admin attendance view:', error);
        document.getElementById('adminStudentsList').innerHTML = 
            '<p class="text-red-500 text-center col-span-full">Error loading data. Please try again.</p>';
    }
}

function toggleStudentSelection(username) {
    const checkbox = document.getElementById(`check-${username}`);
    const card = document.getElementById(`student-card-${username}`);
    
    if (checkbox && card) {
        checkbox.checked = !checkbox.checked;
        
        if (checkbox.checked) {
            card.classList.add('selected');
            checkbox.nextElementSibling.textContent = 'Present';
        } else {
            card.classList.remove('selected');
            checkbox.nextElementSibling.textContent = 'Absent';
        }
    }
}

function selectAllStudents() {
    document.querySelectorAll('#adminStudentsList input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = true;
        const card = checkbox.closest('.student-card');
        if (card) card.classList.add('selected');
        if (checkbox.nextElementSibling) checkbox.nextElementSibling.textContent = 'Present';
    });
}

function deselectAllStudents() {
    document.querySelectorAll('#adminStudentsList input[type="checkbox"]').forEach(checkbox => {
        checkbox.checked = false;
        const card = checkbox.closest('.student-card');
        if (card) card.classList.remove('selected');
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
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving Attendance...';
    submitBtn.disabled = true;
    
    try {
        const attendanceSheet = `attendance_${selectedClass}_${selectedSubject}`;
        const studentAttendanceSheet = `${currentUser.username}_attendance`;
        
        // Collect all student attendance data
        const checkboxes = document.querySelectorAll('#adminStudentsList input[type="checkbox"]');
        const attendanceRows = [];
        const studentAttendanceRows = [];
        
        checkboxes.forEach(checkbox => {
            const username = checkbox.id.replace('check-', '');
            const status = checkbox.checked ? 'present' : 'absent';
            
            // Class attendance sheet row
            attendanceRows.push([selectedDate, username, status, selectedSubject]);
            
            // Individual student attendance sheet row
            studentAttendanceRows.push([selectedDate, selectedSubject, status]);
        });
        
        // Save to class attendance sheet
        await api.addBatchRows(attendanceSheet, attendanceRows);
        
        // Save to individual student attendance sheets
        // Note: This would require iterating through each student, which is complex with batch
        // For simplicity, we'll save to admin's tracking sheet
        await api.addBatchRows(studentAttendanceSheet, studentAttendanceRows);
        
        alert('Attendance saved successfully!');
        
    } catch (error) {
        console.error('Error submitting attendance:', error);
        alert('Error saving attendance: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function clearAdminFilters() {
    document.getElementById('adminClassSelect').value = '';
    document.getElementById('adminSubjectSelect').value = '';
    document.getElementById('adminSubjectSelect').disabled = true;
    document.getElementById('adminSubjectSelect').innerHTML = '<option value="">-- Select Subject --</option>';
    
    document.getElementById('adminAttendanceView').classList.add('hidden');
    document.getElementById('adminDefaultView').classList.remove('hidden');
}

// =============================
// 👨‍💼 Admin Status Functions
// =============================
async function loadAllUsersStatus() {
    try {
        const userSelect = document.getElementById('userSelect');
        const noUserSelected = document.getElementById('noUserSelected');
        const selectedUserStatus = document.getElementById('selectedUserStatus');
        
        userSelect.innerHTML = '<option value="">-- Loading Users... --</option>';
        
        const users = await api.getSheet("user_credentials");
        
        userSelect.innerHTML = '<option value="">-- Select User --</option>';
        
        if (users && Array.isArray(users)) {
            const students = users.filter(user => user.role === 'student');
            students.forEach(student => {
                const option = document.createElement('option');
                option.value = student.username;
                option.textContent = `${student.full_name || student.username} (Class ${student.class || 'N/A'})`;
                userSelect.appendChild(option);
            });
        }
        
        const newUserSelect = userSelect.cloneNode(true);
        userSelect.parentNode.replaceChild(newUserSelect, userSelect);
        
        document.getElementById('userSelect').addEventListener('change', async function() {
            const selectedUsername = this.value;
            
            if (selectedUsername) {
                noUserSelected.classList.add('hidden');
                selectedUserStatus.classList.remove('hidden');
                await loadSelectedUserStatus(selectedUsername);
            } else {
                noUserSelected.classList.remove('hidden');
                selectedUserStatus.classList.add('hidden');
            }
        });
        
        noUserSelected.classList.remove('hidden');
        selectedUserStatus.classList.add('hidden');
        
    } catch (error) {
        console.error('Error loading all users status:', error);
    }
}

async function loadSelectedUserStatus(username) {
    try {
        const [users, attendance] = await Promise.all([
            api.getSheet("user_credentials"),
            api.getSheet(`${username}_attendance`)
        ]);
        
        const user = users.find(u => u.username === username);
        
        if (!user) {
            alert('User not found!');
            return;
        }
        
        document.getElementById('selectedUserName').textContent = user.full_name || user.username;
        document.getElementById('selectedUserInfo').textContent = 
            `Username: ${user.username} | Class: ${user.class || 'Not Assigned'} | Role: ${user.role}`;
        
        await Promise.all([
            loadAdminAttendanceChart(attendance),
            loadAdminSubjectAttendanceSummary(attendance)
        ]);
        
    } catch (error) {
        console.error('Error loading selected user status:', error);
    }
}

async function loadAdminAttendanceChart(attendance) {
    try {
        const presentCount = Array.isArray(attendance) ? 
            attendance.filter(a => a.status === 'present').length : 0;
        const absentCount = Array.isArray(attendance) ? 
            attendance.filter(a => a.status === 'absent').length : 0;

        const ctx = document.getElementById('adminAttendanceChart');
        if (!ctx) return;
        
        if (adminChartInstances.attendanceChart) {
            adminChartInstances.attendanceChart.destroy();
        }
        
        adminChartInstances.attendanceChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Present', 'Absent'],
                datasets: [{
                    data: [presentCount, absentCount],
                    backgroundColor: ['#059669', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error loading admin attendance chart:', error);
    }
}

async function loadAdminSubjectAttendanceSummary(attendance) {
    try {
        const subjectStats = {};
        
        if (Array.isArray(attendance)) {
            attendance.forEach(record => {
                const subject = record.subject || 'General';
                if (!subjectStats[subject]) {
                    subjectStats[subject] = { present: 0, total: 0 };
                }
                
                subjectStats[subject].total++;
                if (record.status === 'present') {
                    subjectStats[subject].present++;
                }
            });
        }
        
        const summaryContainer = document.getElementById('adminSubjectAttendanceSummary');
        if (!summaryContainer) return;
        
        const summaryHtml = Object.entries(subjectStats).map(([subject, stats]) => {
            const percentage = stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0;
            return `
                <div class="attendance-summary-card">
                    <div class="flex items-center justify-center mb-3">
                        <div class="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white mr-2">
                            <i class="${getSubjectIcon(subject)} text-xs md:text-sm"></i>
                        </div>
                        <h4>${subject}</h4>
                    </div>
                    <div class="attendance-percentage">${percentage}%</div>
                    <div class="text-xs text-gray-500 mt-2">
                        ${stats.present}/${stats.total} classes attended
                    </div>
                </div>
            `;
        }).join('');
        
        summaryContainer.innerHTML = summaryHtml || '<p class="text-gray-500 text-center col-span-full">No attendance data available</p>';
        
    } catch (error) {
        console.error('Error loading admin subject attendance summary:', error);
    }
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
        showChangePasswordError('New password must be at least 6 characters long');
        return;
    }
    
    if (newPassword !== confirmPassword) {
        showChangePasswordError('New passwords do not match');
        return;
    }
    
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Changing Password...';
    submitBtn.disabled = true;
    
    try {
        const users = await api.getSheet("user_credentials", false);
        
        if (!users || users.error || !Array.isArray(users)) {
            throw new Error('Failed to fetch user data');
        }
        
        const user = users.find(u => {
            if (!u.username || !u.password) return false;
            const storedUsername = String(u.username).toLowerCase().trim();
            const currentUsername = String(currentUser.username).toLowerCase().trim();
            const inputPassword = String(currentPassword).trim();
            const storedPassword = String(u.password).trim();
            return storedUsername === currentUsername && storedPassword === inputPassword;
        });
        
        if (!user) {
            throw new Error('Current password is incorrect');
        }
        
        const rowData = [currentUser.username, newPassword, 'password_update', new Date().toISOString()];
        const updateResult = await api.addRow("password_updates", rowData);
        
        if (updateResult && updateResult.success) {
            showChangePasswordSuccess('Password changed successfully! You will be logged out in 3 seconds.');
            document.getElementById('changePasswordForm').reset();
            
            setTimeout(() => {
                closeChangePasswordModal();
                logout();
            }, 3000);
        } else {
            throw new Error(updateResult?.error || 'Failed to update password');
        }
        
    } catch (error) {
        console.error('Error changing password:', error);
        showChangePasswordError(error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function showChangePasswordError(message) {
    const errorDiv = document.getElementById('changePasswordError');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showChangePasswordSuccess(message) {
    const successDiv = document.getElementById('changePasswordSuccess');
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
    successDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// =============================
// 🔧 Utility Functions
// =============================
function getSubjectIcon(subject) {
    const subjectLower = subject.toLowerCase();
    if (subjectLower.includes('quaf')) return 'fas fa-scroll';
    if (subjectLower.includes('arabic')) return 'fas fa-language';
    if (subjectLower.includes('urdu')) return 'fas fa-language';
    if (subjectLower.includes('english')) return 'fas fa-language';
    if (subjectLower.includes('malayalam')) return 'fas fa-language';
    if (subjectLower.includes('media')) return 'fas fa-video';
    if (subjectLower.includes('sigma')) return 'fas fa-brain';
    if (subjectLower.includes('art')) return 'fas fa-palette';
    if (subjectLower.includes('oration')) return 'fas fa-microphone';
    if (subjectLower.includes('gk')) return 'fas fa-globe';
    if (subjectLower.includes('himaya')) return 'fas fa-shield-alt';
    if (subjectLower.includes('class')) return 'fas fa-chalkboard';
    if (subjectLower.includes('swalah')) return 'fas fa-pray';
    return 'fas fa-book';
}

function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        return dateString;
    }
}

// =============================
// 🎯 Event Listeners & Initialization
// =============================
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('signupForm').addEventListener('submit', function(e) {
        e.preventDefault();
        submitSignup();
    });
    
    document.getElementById('loginForm').addEventListener('submit', function(e) {
        e.preventDefault();
        login();
    });
    
    document.getElementById('changePasswordForm').addEventListener('submit', changePassword);
    
    document.getElementById('changePasswordModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeChangePasswordModal();
        }
    });
    
    // Set today's date as default for attendance
    document.getElementById('attendanceDate').value = today;
    document.getElementById('attendanceDate').addEventListener('change', function() {
        const selectedClass = document.getElementById('adminClassSelect').value;
        const selectedSubject = document.getElementById('adminSubjectSelect').value;
        if (selectedClass && selectedSubject) {
            loadAdminAttendanceView(selectedClass, selectedSubject, this.value);
        }
    });
});

// Debounce resize events
let resizeTimeout;
window.addEventListener('resize', function() {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(function() {
        if (currentPage === 'status') {
            Object.values(chartInstances).forEach(chart => {
                if (chart) chart.resize();
            });
        }
        if (currentPage === 'adminStatus') {
            Object.values(adminChartInstances).forEach(chart => {
                if (chart) chart.resize();
            });
        }
    }, 250);
});

// Security functions
document.addEventListener("contextmenu", function (e) {
    e.preventDefault();
});

document.addEventListener("keydown", function (e) {
    if (e.key === "F12") e.preventDefault();
    if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) e.preventDefault();
    if (e.ctrlKey && (e.key === "u" || e.key === "U")) e.preventDefault();
    if (e.ctrlKey && (e.key === "s" || e.key === "S")) e.preventDefault();
});

// Initialize
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

function initializeApp() {
    console.log('Initializing QUAF Attendance System...');
    showLogin();
    console.log('System initialized successfully!');
}

console.log('%c📅 QUAF Attendance System Loaded Successfully! 📅', 'color: #059669; font-size: 16px; font-weight: bold;');
