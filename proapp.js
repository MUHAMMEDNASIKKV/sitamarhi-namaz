// 🌐 Global Variables
let currentUser = null;
let currentPage = 'tasks';
let chartInstances = {};
let adminChartInstances = {};
let selectedClassForModal = null;
let selectedSubjectForModal = null;

// Cache for better performance
let dataCache = {
    users: null,
    tasks: null,
    courses: null,
    events: null,
    lastUpdated: null
};

// =============================
// 📊 Google Sheets Integration (OPTIMIZED)
// =============================
class GoogleSheetsAPI {
    constructor() {
        this.apiUrl = "https://script.google.com/macros/s/AKfycbw0jNeTVwrG8wVloSCtsqPf76yAy4_LP4JrZa9OGoIOivBQ2B0OaEBr5XHyhCUjvh_cXg/exec";
        this.cache = new Map();
        this.localCache = this.initLocalCache();
        this.cacheTimeout = 30 * 1000; // 30 seconds only
        this.requestQueue = [];
        this.processing = false;
    }

    initLocalCache() {
        try {
            const cached = localStorage.getItem('dhdc_cache');
            return cached ? JSON.parse(cached) : {};
        } catch {
            return {};
        }
    }

    saveLocalCache() {
        try {
            localStorage.setItem('dhdc_cache', JSON.stringify(this.localCache));
        } catch (e) {
            console.warn('Failed to save cache:', e);
        }
    }

    async getSheet(sheetName, useCache = true) {
        const cacheKey = sheetName;
        const now = Date.now();
        
        // Check in-memory cache first (fastest)
        if (useCache && this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (now - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }
        
        // Check localStorage cache (fast)
        if (useCache && this.localCache[cacheKey]) {
            const cached = this.localCache[cacheKey];
            if (now - cached.timestamp < 5 * 60 * 1000) { // 5 minutes for localStorage
                this.cache.set(cacheKey, cached); // Promote to memory cache
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
            
            // Cache in both memory and localStorage
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

    // Batch multiple sheet requests
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
        localStorage.removeItem('dhdc_cache');
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
            
            // Invalidate related caches
            this.cache.delete(sheetName);
            delete this.localCache[sheetName];
            this.saveLocalCache();
            
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }

    async updatePassword(username, newPassword) {
        try {
            const response = await fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    sheet: "password_updates",
                    data: JSON.stringify([username, newPassword])
                })
            });
            
            const result = await response.json();
            
            // Clear user credentials cache since password changed
            this.cache.delete("user_credentials");
            delete this.localCache["user_credentials"];
            this.saveLocalCache();
            
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }

    // Alternative method using PUT request
    async updatePasswordPut(username, newPassword) {
        try {
            const response = await fetch(`${this.apiUrl}?action=updatePassword&username=${encodeURIComponent(username)}&newPassword=${encodeURIComponent(newPassword)}`, {
                method: "PUT"
            });
            
            const result = await response.json();
            
            // Clear user credentials cache since password changed
            this.cache.delete("user_credentials");
            delete this.localCache["user_credentials"];
            this.saveLocalCache();
            
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }
}

const api = new GoogleSheetsAPI();

// =============================
// 👤 Profile Picture Functions
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
    
    // Set profile picture with fallback chain
    profilePic.src = `https://quaf.tech/pic/${username}.png`;
    profilePic.onerror = function() {
        this.onerror = function() {
            this.onerror = function() {
                // All formats failed, show fallback
                this.style.display = 'none';
                profileFallback.classList.remove('hidden');
            };
            this.src = `https://quaf.tech/pic/${username}.jpeg`;
        };
        this.src = `https://quaf.tech/pic/${username}.jpg`;
    };
    
    profilePic.style.display = 'block';
    profileFallback.classList.add('hidden');
    
    // Set profile info
    if (currentUser) {
        profileName.textContent = currentUser.name;
        profileUsername.textContent = `@${username}`;
    }
}

// Close profile menu when clicking outside
document.addEventListener('click', function(event) {
    const profileContainer = event.target.closest('.profile-pic-container');
    const profileMenu = document.getElementById('profileMenu');
    
    if (!profileContainer && profileMenu && !profileMenu.classList.contains('hidden')) {
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

            // Show dashboard immediately
            document.getElementById('loginPage').classList.add('hidden');
            document.getElementById('dashboardContainer').classList.remove('hidden');
            document.getElementById('welcomeUser').textContent = `Welcome, ${currentUser.name}`;

            // Load user profile picture
            loadUserProfile(username);

            // Pre-load common data in background
            if (currentUser.role === 'admin') {
                document.getElementById('studentNav').classList.add('hidden');
                document.getElementById('adminNav').classList.remove('hidden');
                
                // Load admin data and show page simultaneously
                Promise.all([
                    loadAdminData(),
                    showPage('adminTasks')
                ]);
            } else {
                document.getElementById('studentNav').classList.remove('hidden');
                document.getElementById('adminNav').classList.add('hidden');
                
                // Load tasks and show page simultaneously
                Promise.all([
                    loadTasks(),
                    showPage('tasks')
                ]);
            }
            
            // Pre-load critical data in background
            setTimeout(() => preloadCriticalData(), 100);
            
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
    selectedClassForModal = null;
    selectedSubjectForModal = null;
    api.clearCache();
    
    // Clean up chart instances
    Object.values(chartInstances).forEach(chart => {
        if (chart) chart.destroy();
    });
    chartInstances = {};
    
    // Clean up admin chart instances
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

    // Validate pin code
    if (!/^\d{6}$/.test(pinCode)) {
        showSignupError('Please enter a valid 6-digit pin code');
        return;
    }

    // Show loading state
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
            new Date().toISOString().split('T')[0] // Registration date
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
// 📍 Navigation (OPTIMIZED)
// =============================
async function showPage(page) {
    document.querySelectorAll('.page-content').forEach(p => p.classList.add('hidden'));
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('border-green-500', 'text-green-600', 'border-blue-500', 'text-blue-600');
        btn.classList.add('border-transparent');
    });

    document.getElementById(page + 'Page').classList.remove('hidden');
    
    // Find the clicked button and highlight it
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

    // Load page-specific data with optimized loading
    if (page === 'status') {
        loadStatusCharts();
    } else if (page === 'adminTasks') {
        if (currentUser.role === 'admin' && (!currentUser.adminClasses || currentUser.adminClasses.length === 0)) {
            await loadAdminData();
        } else if (currentUser.adminClasses) {
            await loadAdminTasks();
        }
    } else if (page === 'adminStatus') {
        await loadAllUsersStatus();
    }
}

// =============================
// ✅ Tasks (SUPER OPTIMIZED)
// =============================
async function loadTasks() {
    const tasksContainer = document.getElementById('subjectCards');
    
    // Show skeleton immediately
    tasksContainer.innerHTML = `
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
        if (currentUser.role === 'student') {
            if (!currentUser.class) {
                tasksContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No class assigned. Please contact administrator.</p>';
                document.getElementById('userClass').textContent = 'Class: Not Assigned';
                return;
            }
            
            document.getElementById('userClass').textContent = `Class ${currentUser.class}`;
            
            // Load data in parallel
            const [tasks, progress] = await Promise.all([
                api.getSheet(`${currentUser.class}_tasks_master`),
                api.getSheet(`${currentUser.username}_progress`)
            ]);
            
            if (!tasks || tasks.error || tasks.length === 0) {
                tasksContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No tasks found for your class.</p>';
                return;
            }

            // Pre-process data for faster rendering
            const progressMap = new Map();
            if (Array.isArray(progress)) {
                progress.forEach(p => {
                    if (p.item_type === "task" && p.status === "complete") {
                        progressMap.set(String(p.item_id), {
                            completed: true,
                            grade: p.grade
                        });
                    }
                });
            }

            // Group tasks by subject with optimized loop
            const tasksBySubject = {};
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            tasks.forEach(task => {
                const subject = task.subject || 'General';
                if (!tasksBySubject[subject]) {
                    tasksBySubject[subject] = {
                        tasks: [],
                        completedCount: 0
                    };
                }
                
                // Pre-calculate status
                const userProgress = progressMap.get(String(task.task_id));
                const completed = !!userProgress;
                if (completed) tasksBySubject[subject].completedCount++;
                
                const dueDate = new Date(task.due_date);
                dueDate.setHours(0, 0, 0, 0);
                
                let statusClass = 'status-pending';
                let statusText = 'Pending';
                
                if (completed) {
                    statusClass = 'status-completed';
                    statusText = 'Completed';
                } else if (dueDate < today) {
                    statusClass = 'status-overdue';
                    statusText = 'Overdue';
                } else if (dueDate.getTime() === today.getTime()) {
                    statusClass = 'status-pending';
                    statusText = 'Due Today';
                }
                
                tasksBySubject[subject].tasks.push({
                    ...task,
                    completed,
                    grade: userProgress?.grade,
                    statusClass,
                    statusText,
                    dueDateFormatted: new Date(task.due_date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                    })
                });
            });

            // Use DocumentFragment for faster DOM manipulation
            const fragment = document.createDocumentFragment();

            Object.entries(tasksBySubject).forEach(([subject, subjectData]) => {
                const { tasks: subjectTasks, completedCount } = subjectData;
                
                const subjectCard = document.createElement('div');
                subjectCard.className = 'subject-card';
                subjectCard.setAttribute('data-subject', subject);
                
                subjectCard.innerHTML = `
                    <div class="subject-header" onclick="toggleSubjectTasks('${subject}')">
                        <div class="flex items-center min-w-0 flex-1">
                            <div class="subject-icon">
                                <i class="${getSubjectIcon(subject)}"></i>
                            </div>
                            <div class="subject-info min-w-0 flex-1">
                                <h3>${subject}</h3>
                                <p>${subjectTasks.length} tasks • ${completedCount} completed</p>
                            </div>
                        </div>
                        <div class="flex items-center space-x-2 flex-shrink-0">
                            <span class="task-count-badge">${subjectTasks.length} tasks</span>
                            <i class="fas fa-chevron-down expand-arrow" id="arrow-${subject}"></i>
                        </div>
                    </div>
                    
                    <div class="tasks-container" id="tasks-${subject}">
                        ${subjectTasks.map(task => `
                            <div class="task-item">
                                <div class="task-header">
                                    <span class="task-id-badge">${task.task_id}</span>
                                    <span class="task-status ${task.statusClass}">${task.statusText}</span>
                                </div>
                                <h4 class="task-title">${task.title}</h4>
                                <p class="task-description">${task.description}</p>
                                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
                                    <p class="task-due-date">
                                        <i class="fas fa-calendar-alt"></i>
                                        Due: ${task.dueDateFormatted}
                                    </p>
                                    ${task.completed && task.grade ? `<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Score: ${task.grade}</span>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
                fragment.appendChild(subjectCard);
            });

            tasksContainer.innerHTML = '';
            tasksContainer.appendChild(fragment);
        }
        
    } catch (error) {
        console.error('Error loading tasks:', error);
        tasksContainer.innerHTML = '<p class="text-red-500 text-center py-8">Error loading tasks. Please try again.</p>';
    }
}

// Function to toggle subject task visibility
function toggleSubjectTasks(subject) {
    const tasksContainer = document.getElementById(`tasks-${subject}`);
    const arrow = document.getElementById(`arrow-${subject}`);
    
    if (tasksContainer && arrow) {
        if (!tasksContainer.classList.contains('expanded')) {
            // Close all other expanded subjects first
            document.querySelectorAll('.tasks-container.expanded').forEach(container => {
                if (container !== tasksContainer) {
                    container.classList.remove('expanded');
                }
            });
            document.querySelectorAll('.expand-arrow.expanded').forEach(arrowIcon => {
                if (arrowIcon !== arrow) {
                    arrowIcon.classList.remove('expanded');
                }
            });
            
            // Open this subject
            tasksContainer.classList.add('expanded');
            arrow.classList.add('expanded');
        } else {
            // Close this subject
            tasksContainer.classList.remove('expanded');
            arrow.classList.remove('expanded');
        }
    }
}

// Helper functions for subject icons
function getSubjectIcon(subject) {
    const subjectLower = subject.toLowerCase();
    if (subjectLower.includes('quaf')) return 'fas fa-scroll';
    if (subjectLower.includes('arabic_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('urdu_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('english_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('malayalam_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('media_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('sigma_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('art_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('oration_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('gk_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('himaya_wing')) return 'fas fa-scroll';
    if (subjectLower.includes('class')) return 'fas fa-scroll';
    if (subjectLower.includes('swalah')) return 'fas fa-scroll';
    return 'fas fa-book';
}

// =============================
// 📊 Status Charts & Progress (OPTIMIZED)
// =============================
async function loadStatusCharts() {
    try {
        const progressSheetName = `${currentUser.username}_progress`;
        const progress = await api.getSheet(progressSheetName);
        
        await Promise.all([
            loadTaskChart(progress),
            loadSubjectPointsSummary(progress)
        ]);
    } catch (error) {
        console.error('Error loading status charts:', error);
    }
}

async function loadSubjectPointsSummary(progress) {
    try {
        if (!currentUser.class) return;
        
        const tasksSheetName = `${currentUser.class}_tasks_master`;
        const tasks = await api.getSheet(tasksSheetName);
        
        if (!tasks || tasks.error || tasks.length === 0) return;
        
        // Group tasks by subject and calculate points
        const subjectStats = {};
        
        tasks.forEach(task => {
            const subject = task.subject || 'General';
            if (!subjectStats[subject]) {
                subjectStats[subject] = {
                    totalTasks: 0,
                    completedTasks: 0,
                    totalPoints: 0,
                    earnedPoints: 0
                };
            }
            
            subjectStats[subject].totalTasks++;
            
            // Check if task is completed
            const userTask = Array.isArray(progress) ? progress.find(p => 
                String(p.item_id) === String(task.task_id) && 
                p.item_type === "task" && 
                p.status === "complete"
            ) : null;
            
            if (userTask) {
                subjectStats[subject].completedTasks++;
                subjectStats[subject].earnedPoints += parseInt(userTask.grade || 0);
            }
        });
        
        // Calculate total points
        Object.keys(subjectStats).forEach(subject => {
            subjectStats[subject].totalPoints = subjectStats[subject].earnedPoints;
        });
        
        // Generate subject points grid
        const subjectPointsGrid = document.getElementById('subjectPointsGrid');
        if (!subjectPointsGrid) return;
        
        const subjectCardsHtml = Object.entries(subjectStats).map(([subject, stats]) => {
            return `
                <div class="subject-points-card">
                    <div class="flex items-center justify-center mb-3">
                        <div class="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center text-white mr-2">
                            <i class="${getSubjectIcon(subject)} text-xs md:text-sm"></i>
                        </div>
                        <h4>${subject}</h4>
                    </div>
                    <div class="points-display">${stats.earnedPoints}</div>
                    <div class="points-label">total points</div>
                    <div class="text-xs text-gray-500 mt-2">
                        ${stats.completedTasks}/${stats.totalTasks} tasks completed
                    </div>
                </div>
            `;
        }).join('');
        
        subjectPointsGrid.innerHTML = subjectCardsHtml;
        
    } catch (error) {
        console.error('Error loading subject points summary:', error);
    }
}

async function loadTaskChart(progress) {
    if (!currentUser.class) return;
    
    try {
        const tasksSheetName = `${currentUser.class}_tasks_master`;
        const tasks = await api.getSheet(tasksSheetName);
        const completedTasks = Array.isArray(progress) ? 
            progress.filter(p => p.item_type === "task" && p.status === "complete").length : 0;
        const totalTasks = Array.isArray(tasks) ? tasks.length : 0;
        const pendingTasks = Math.max(0, totalTasks - completedTasks);

        const ctx = document.getElementById('taskChart');
        if (!ctx) return;
        
        if (chartInstances.taskChart) {
            chartInstances.taskChart.destroy();
        }
        
        chartInstances.taskChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Completed', 'Pending'],
                datasets: [{
                    data: [completedTasks, pendingTasks],
                    backgroundColor: ['#059669', '#e5e7eb'],
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
        console.error('Error loading task chart:', error);
    }
}

// =============================
// 👨‍💼 Admin Functions (SUPER OPTIMIZED)
// =============================
async function loadAdminData() {
    try {
        if (currentUser.role === 'admin') {
            let adminClasses = [];
            let adminSubjects = {};
            
            // Parse classes (optimized)
            if (currentUser.class) {
                adminClasses = currentUser.class.toString().trim()
                    .split(/[,\s]+/)
                    .map(c => c.trim())
                    .filter(c => c && /^\d+$/.test(c));
            }
            
            // Parse subjects (optimized)
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
            
            // Pre-load all task sheets in parallel
            const taskSheetPromises = adminClasses.map(classNum => 
                api.getSheet(`${classNum}_tasks_master`).then(tasks => ({
                    classNum,
                    tasks: tasks && Array.isArray(tasks) ? tasks : []
                }))
            );
            
            const taskResults = await Promise.all(taskSheetPromises);
            
            // Verify subjects exist and optimize
            taskResults.forEach(({ classNum, tasks }) => {
                if (tasks.length > 0) {
                    const classSubjects = [...new Set(tasks.map(task => 
                        task.subject ? task.subject.toLowerCase().trim() : ''
                    ).filter(s => s))];
                    
                    if (adminSubjects[classNum]) {
                        adminSubjects[classNum] = adminSubjects[classNum].filter(subject => 
                            classSubjects.includes(subject.toLowerCase())
                        );
                    } else {
                        adminSubjects[classNum] = [];
                    }
                } else {
                    adminSubjects[classNum] = [];
                }
            });
            
            currentUser.adminClasses = adminClasses;
            currentUser.adminSubjects = adminSubjects;
            
            // Update UI immediately
            const teachingInfo = document.getElementById('teachingSubjects');
            if (teachingInfo) {
                if (adminClasses.length > 0) {
                    const classText = `Classes: ${adminClasses.join(', ')}`;
                    const subjectText = Object.entries(adminSubjects).map(([cls, subjs]) => 
                        `Class ${cls}: ${subjs.length > 0 ? subjs.join(', ') : 'No subjects'}`
                    ).join(' | ');
                    teachingInfo.textContent = `${classText} | ${subjectText}`;
                } else {
                    teachingInfo.textContent = 'No classes or subjects assigned';
                }
            }
            
            // Load admin tasks UI immediately after data processing
            await loadAdminTasks();
        }
    } catch (error) {
        console.error('Error loading admin data:', error);
        const teachingInfo = document.getElementById('teachingSubjects');
        if (teachingInfo) {
            teachingInfo.textContent = 'Error loading teaching assignments';
        }
    }
}

async function loadAdminTasks() {
    const adminTaskClassSelect = document.getElementById('adminTaskClassSelect');
    const adminTaskSubjectSelect = document.getElementById('adminTaskSubjectSelect');
    
    if (!adminTaskClassSelect || !adminTaskSubjectSelect) return;
    
    // Clear existing options
    adminTaskClassSelect.innerHTML = '<option value="">-- Select Class --</option>';
    adminTaskSubjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';
    adminTaskSubjectSelect.disabled = true;
    
    // Only show admin's assigned classes
    if (currentUser.adminClasses && currentUser.adminClasses.length > 0) {
        currentUser.adminClasses.forEach(classNum => {
            const option = document.createElement('option');
            option.value = classNum;
            option.textContent = `Class ${classNum}`;
            adminTaskClassSelect.appendChild(option);
        });
    } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No classes assigned';
        option.disabled = true;
        adminTaskClassSelect.appendChild(option);
        return;
    }
    
    // Remove existing event listeners first
    adminTaskClassSelect.removeEventListener('change', handleClassChange);
    adminTaskSubjectSelect.removeEventListener('change', handleSubjectChange);
    
    // Add event listeners
    adminTaskClassSelect.addEventListener('change', handleClassChange);
    adminTaskSubjectSelect.addEventListener('change', handleSubjectChange);
}

// Separate event handler functions
async function handleClassChange() {
    const selectedClass = this.value;
    const subjectSelect = document.getElementById('adminTaskSubjectSelect');
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
        } else {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No subjects assigned to this class';
            option.disabled = true;
            subjectSelect.appendChild(option);
        }
    } else {
        subjectSelect.disabled = true;
    }
    
    document.getElementById('adminTasksClassSubjectView').classList.add('hidden');
    document.getElementById('adminTasksDefaultView').classList.remove('hidden');
}

async function handleSubjectChange() {
    const selectedClass = document.getElementById('adminTaskClassSelect').value;
    const selectedSubject = this.value;
    
    if (selectedClass && selectedSubject) {
        const hasAccess = currentUser.adminSubjects && 
                         currentUser.adminSubjects[selectedClass] && 
                         currentUser.adminSubjects[selectedClass].includes(selectedSubject);
        
        if (hasAccess) {
            selectedClassForModal = selectedClass;
            selectedSubjectForModal = selectedSubject;
            await loadAdminClassSubjectData(selectedClass, selectedSubject);
        } else {
            alert('Access denied: You are not assigned to this class-subject combination.');
            this.value = '';
        }
    } else {
        document.getElementById('adminTasksClassSubjectView').classList.add('hidden');
        document.getElementById('adminTasksDefaultView').classList.remove('hidden');
    }
}

async function loadAdminClassSubjectData(classNum, subject) {
    try {
        // Show class subject view
        document.getElementById('adminTasksDefaultView').classList.add('hidden');
        document.getElementById('adminTasksClassSubjectView').classList.remove('hidden');
        
        // Update selected info
        document.getElementById('selectedClassSubjectInfo').textContent = `Class ${classNum} - ${subject.charAt(0).toUpperCase() + subject.slice(1)}`;
        
        // Load tasks for this class and subject
        const tasksSheetName = `${classNum}_tasks_master`;
        const tasks = await api.getSheet(tasksSheetName);
        
        const adminClassSubjectTasksList = document.getElementById('adminClassSubjectTasksList');
        
        // Show skeleton while loading
        adminClassSubjectTasksList.innerHTML = `
            <div class="animate-pulse space-y-3">
                ${Array(2).fill(0).map(() => `
                    <div class="bg-gray-50 rounded-lg p-4 border">
                        <div class="flex justify-between items-center mb-2">
                            <div class="h-4 bg-gray-200 rounded w-16"></div>
                            <div class="h-6 bg-gray-200 rounded w-20"></div>
                        </div>
                        <div class="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
                        <div class="h-4 bg-gray-200 rounded w-full mb-2"></div>
                        <div class="h-3 bg-gray-200 rounded w-32"></div>
                    </div>
                `).join('')}
            </div>
        `;
        
        if (!tasks || tasks.error || tasks.length === 0) {
            adminClassSubjectTasksList.innerHTML = '<p class="text-gray-500 text-center py-8">No tasks found for this class.</p>';
        } else {
            // Filter tasks by subject
            const subjectTasks = tasks.filter(task => 
                task.subject && task.subject.toLowerCase() === subject.toLowerCase()
            );
            
            if (subjectTasks.length === 0) {
                adminClassSubjectTasksList.innerHTML = `<p class="text-gray-500 text-center py-8">No tasks found for ${subject} in Class ${classNum}.</p>`;
            } else {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const tasksHtml = subjectTasks.map(task => {
                    const dueDate = new Date(task.due_date);
                    dueDate.setHours(0, 0, 0, 0);
                    const isOverdue = dueDate < today;
                    const isDueToday = dueDate.getTime() === today.getTime();
                    
                    let statusClass = 'status-pending';
                    let statusText = 'Active';
                    
                    if (isOverdue) {
                        statusClass = 'status-overdue';
                        statusText = 'Overdue';
                    } else if (isDueToday) {
                        statusClass = 'status-pending';
                        statusText = 'Due Today';
                    }
                    
                    return `
                        <div class="task-item">
                            <div class="flex items-start justify-between">
                                <div class="flex-1">
                                    <div class="flex items-center justify-between mb-2">
                                        <span class="task-id-badge">${task.task_id}</span>
                                        <span class="task-status ${statusClass}">${statusText}</span>
                                    </div>
                                    <h4 class="task-title">${task.title}</h4>
                                    <p class="task-description">${task.description}</p>
                                    <p class="task-due-date">
                                        <i class="fas fa-calendar-alt"></i>
                                        Due: ${new Date(task.due_date).toLocaleDateString('en-US', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric'
                                        })}
                                    </p>
                                </div>
                            </div>
                        </div>
                    `;
                }).join('');
                
                adminClassSubjectTasksList.innerHTML = tasksHtml;
            }
        }
        
        // Load students in this class
        await loadAdminClassStudents(classNum);
        
    } catch (error) {
        console.error('Error loading admin class subject data:', error);
        document.getElementById('adminClassSubjectTasksList').innerHTML = '<p class="text-red-500 text-center py-8">Error loading tasks. Please try again.</p>';
    }
}

async function loadAdminClassStudents(classNum) {
    try {
        const users = await api.getSheet("user_credentials");
        const adminClassStudentsList = document.getElementById('adminClassStudentsList');
        
        // Show skeleton
        adminClassStudentsList.innerHTML = `
            <div class="animate-pulse grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                ${Array(6).fill(0).map(() => `
                    <div class="bg-white rounded-lg p-4 border-2 border-gray-200 text-center">
                        <div class="w-12 h-12 bg-gray-200 rounded-full mx-auto mb-3"></div>
                        <div class="h-4 bg-gray-200 rounded w-3/4 mx-auto mb-2"></div>
                        <div class="h-3 bg-gray-200 rounded w-1/2 mx-auto mb-2"></div>
                        <div class="h-6 bg-gray-200 rounded w-16 mx-auto"></div>
                    </div>
                `).join('')}
            </div>
        `;
        
        if (!users || users.error) {
            adminClassStudentsList.innerHTML = '<p class="text-red-500 text-center py-8">Error loading students.</p>';
            return;
        }
        
        // Filter students by class
        const classStudents = users.filter(user => 
            user.role === 'student' && String(user.class) === String(classNum)
        );
        
        if (classStudents.length === 0) {
            adminClassStudentsList.innerHTML = `<p class="text-gray-500 text-center py-8">No students found in Class ${classNum}.</p>`;
            return;
        }
        
        const studentsHtml = classStudents.map(student => {
            const initials = student.full_name ? 
                student.full_name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
                student.username.substring(0, 2).toUpperCase();
            
            return `
                <div class="student-card" onclick="openStudentTaskModal('${student.username}', '${student.full_name || student.username}', '${classNum}')">
                    <div class="student-avatar">${initials}</div>
                    <div class="student-name">${student.full_name || student.username}</div>
                    <div class="student-username">@${student.username}</div>
                    <div class="student-class">Class ${student.class}</div>
                </div>
            `;
        }).join('');
        
        adminClassStudentsList.innerHTML = studentsHtml;
        
    } catch (error) {
        console.error('Error loading admin class students:', error);
        const adminClassStudentsList = document.getElementById('adminClassStudentsList');
        adminClassStudentsList.innerHTML = '<p class="text-red-500 text-center py-8">Error loading students. Please try again.</p>';
    }
}

async function openStudentTaskModal(username, fullName, classNum) {
    try {
        const modal = document.getElementById('studentTaskModal');
        const title = document.getElementById('studentTaskModalTitle');
        const content = document.getElementById('studentTaskModalContent');
        
        title.textContent = `Tasks for ${fullName} - ${selectedSubjectForModal}`;
        
        // Show skeleton immediately
        content.innerHTML = `
            <div class="animate-pulse space-y-4">
                ${Array(3).fill(0).map(() => `
                    <div class="bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
                        <div class="flex items-start space-x-3">
                            <div class="w-4 h-4 bg-gray-200 rounded mt-1"></div>
                            <div class="flex-1">
                                <div class="flex justify-between items-center mb-2">
                                    <div class="h-4 bg-gray-200 rounded w-16"></div>
                                    <div class="h-6 bg-gray-200 rounded w-20"></div>
                                </div>
                                <div class="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
                                <div class="h-4 bg-gray-200 rounded w-full mb-2"></div>
                                <div class="h-3 bg-gray-200 rounded w-32"></div>
                            </div>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
        
        modal.classList.remove('hidden');
        
        // Load student's progress and class tasks in parallel
        const [progress, tasks] = await Promise.all([
            api.getSheet(`${username}_progress`),
            api.getSheet(`${classNum}_tasks_master`)
        ]);
        
        if (!tasks || tasks.error || tasks.length === 0) {
            content.innerHTML = '<p class="text-gray-500 text-center py-8">No tasks found for this class.</p>';
            return;
        }
        
        // Filter tasks by the selected subject
        const subjectTasks = selectedSubjectForModal ? 
            tasks.filter(task => task.subject && task.subject.toLowerCase() === selectedSubjectForModal.toLowerCase()) :
            tasks;
        
        if (subjectTasks.length === 0) {
            content.innerHTML = `<p class="text-gray-500 text-center py-8">No tasks found for ${selectedSubjectForModal} in this class.</p>`;
            return;
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const tasksHtml = subjectTasks.map(task => {
            const userTask = Array.isArray(progress) ? progress.find(p => 
                String(p.item_id) === String(task.task_id) && 
                p.item_type === "task" && 
                p.status === "complete"
            ) : null;
            
            const completed = !!userTask;
            const currentGrade = userTask ? parseInt(userTask.grade || 30) : 30;
            
            const dueDate = new Date(task.due_date);
            dueDate.setHours(0, 0, 0, 0);
            const isOverdue = !completed && dueDate < today;
            const isDueToday = dueDate.getTime() === today.getTime();
            
            let taskClass = 'admin-task-item';
            let statusIcon = '';
            let statusText = '';
            
            if (completed) {
                taskClass += ' completed';
                statusIcon = '<i class="fas fa-check-circle text-green-500"></i>';
                statusText = `Completed (${currentGrade}/30)`;
            } else if (isOverdue) {
                statusIcon = '<i class="fas fa-exclamation-triangle text-red-500"></i>';
                statusText = 'Overdue';
            } else if (isDueToday) {
                statusIcon = '<i class="fas fa-clock text-orange-500"></i>';
                statusText = 'Due Today';
            } else {
                statusIcon = '<i class="fas fa-clock text-gray-400"></i>';
                statusText = 'Pending';
            }
            
            return `
                <div class="${taskClass}">
                    <div class="flex items-start space-x-3">
                        <input type="checkbox" 
                               data-task-id="${task.task_id}"
                               data-username="${username}"
                               ${completed ? 'checked disabled' : ''}
                               class="task-checkbox"
                               onchange="toggleGradeSection('${task.task_id}', this.checked)">
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-2">
                                <span class="task-id-badge">${task.task_id}</span>
                                <div class="flex items-center space-x-2">
                                    ${statusIcon}
                                    <span class="text-xs font-medium">${statusText}</span>
                                </div>
                            </div>
                            <h4 class="task-title">${task.title}</h4>
                            <p class="task-description">${task.description}</p>
                            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2">
                                <p class="task-due-date">
                                    <i class="fas fa-calendar-alt mr-1"></i>
                                    Due: ${new Date(task.due_date).toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric'
                                    })}
                                </p>
                                <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                    ${task.subject}
                                </span>
                            </div>
                            <div class="grade-section" id="grade-${task.task_id}">
                                <div class="grade-input-group">
                                    <span class="grade-label">Points:</span>
                                    <input type="number" 
                                           class="grade-input" 
                                           id="grade-input-${task.task_id}"
                                           min="0" 
                                           value="${currentGrade}"
                                           placeholder="Enter points">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        content.innerHTML = tasksHtml;
        
    } catch (error) {
        console.error('Error opening student task modal:', error);
        const content = document.getElementById('studentTaskModalContent');
        content.innerHTML = '<p class="text-red-500 text-center py-8">Error loading student tasks. Please try again.</p>';
    }
}

function toggleGradeSection(taskId, isChecked) {
    const gradeSection = document.getElementById(`grade-${taskId}`);
    if (gradeSection) {
        if (isChecked) {
            gradeSection.classList.add('show');
        } else {
            gradeSection.classList.remove('show');
        }
    }
}

async function submitSelectedStudentTasks() {
    const submitBtn = event.target;
    const originalText = submitBtn.innerHTML;
    
    try {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
        submitBtn.disabled = true;
        
        const selectedCheckboxes = document.querySelectorAll('#studentTaskModalContent input[type="checkbox"]:checked:not(:disabled)');
        
        if (selectedCheckboxes.length === 0) {
            alert('No tasks selected for submission.');
            return;
        }
        
        const promises = [];
        let updatedCount = 0;
        
        for (let checkbox of selectedCheckboxes) {
            const taskId = checkbox.getAttribute('data-task-id');
            const username = checkbox.getAttribute('data-username');
            const gradeInput = document.getElementById(`grade-input-${taskId}`);
            let grade = 0;
            
            if (gradeInput && gradeInput.value) {
                grade = Math.max(0, parseInt(gradeInput.value) || 0);
            }
            
            const rowData = [
                taskId,
                "task",
                "complete",
                new Date().toISOString().split('T')[0],
                grade.toString()
            ];
            
            promises.push(api.addRow(`${username}_progress`, rowData));
            updatedCount++;
        }
        
        await Promise.all(promises);
        alert(`${updatedCount} task(s) marked as completed successfully!`);
        closeStudentTaskModal();
        
        // Refresh the current view
        const selectedClass = document.getElementById('adminTaskClassSelect').value;
        const selectedSubject = document.getElementById('adminTaskSubjectSelect').value;
        if (selectedClass && selectedSubject) {
            await loadAdminClassSubjectData(selectedClass, selectedSubject);
        }
        
    } catch (error) {
        console.error('Error submitting selected student tasks:', error);
        alert('Error submitting tasks. Please try again.');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function closeStudentTaskModal() {
    document.getElementById('studentTaskModal').classList.add('hidden');
}

// Clear admin task filters
function clearAdminTaskFilters() {
    document.getElementById('adminTaskClassSelect').value = '';
    document.getElementById('adminTaskSubjectSelect').value = '';
    document.getElementById('adminTaskSubjectSelect').disabled = true;
    document.getElementById('adminTaskSubjectSelect').innerHTML = '<option value="">-- Select Subject --</option>';
    
    selectedClassForModal = null;
    selectedSubjectForModal = null;
    
    document.getElementById('adminTasksClassSubjectView').classList.add('hidden');
    document.getElementById('adminTasksDefaultView').classList.remove('hidden');
}

// =============================
// 👨‍💼 Admin Status Functions (OPTIMIZED)
// =============================
async function loadAllUsersStatus() {
    try {
        const userSelect = document.getElementById('userSelect');
        const noUserSelected = document.getElementById('noUserSelected');
        const selectedUserStatus = document.getElementById('selectedUserStatus');
        
        // Show loading in user select
        userSelect.innerHTML = '<option value="">-- Loading Users... --</option>';
        
        // Load all users
        const users = await api.getSheet("user_credentials");
        
        // Clear and populate user select
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
        
        // Remove existing event listeners to avoid duplication
        const newUserSelect = userSelect.cloneNode(true);
        userSelect.parentNode.replaceChild(newUserSelect, userSelect);
        
        // Add event listener for user selection
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
        
        // Show no user selected initially
        noUserSelected.classList.remove('hidden');
        selectedUserStatus.classList.add('hidden');
        
    } catch (error) {
        console.error('Error loading all users status:', error);
        const userSelect = document.getElementById('userSelect');
        userSelect.innerHTML = '<option value="">-- Error Loading Users --</option>';
    }
}

async function loadSelectedUserStatus(username) {
    try {
        // Load user data and progress in parallel
        const [users, progress] = await Promise.all([
            api.getSheet("user_credentials"),
            api.getSheet(`${username}_progress`)
        ]);
        
        const user = users.find(u => u.username === username);
        
        if (!user) {
            alert('User not found!');
            return;
        }
        
        // Update user info display
        document.getElementById('selectedUserName').textContent = user.full_name || user.username;
        document.getElementById('selectedUserInfo').textContent = `Username: ${user.username} | Class: ${user.class || 'Not Assigned'} | Role: ${user.role}`;
        
        // Load simplified admin status (only task chart and subject points)
        await Promise.all([
            loadAdminTaskChart(progress, user.class),
            loadAdminSubjectPointsSummary(progress, user.class)
        ]);
        
    } catch (error) {
        console.error('Error loading selected user status:', error);
        alert('Error loading user status. Please try again.');
    }
}

async function loadAdminTaskChart(progress, userClass) {
    if (!userClass) return;
    
    try {
        const tasksSheetName = `${userClass}_tasks_master`;
        const tasks = await api.getSheet(tasksSheetName);
        const completedTasks = Array.isArray(progress) ? 
            progress.filter(p => p.item_type === "task" && p.status === "complete").length : 0;
        const totalTasks = Array.isArray(tasks) ? tasks.length : 0;
        const pendingTasks = Math.max(0, totalTasks - completedTasks);

        const ctx = document.getElementById('adminTaskChart');
        if (!ctx) return;
        
        if (adminChartInstances.taskChart) {
            adminChartInstances.taskChart.destroy();
        }
        
        adminChartInstances.taskChart = new Chart(ctx.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['Completed', 'Pending'],
                datasets: [{
                    data: [completedTasks, pendingTasks],
                    backgroundColor: ['#059669', '#e5e7eb'],
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
        console.error('Error loading admin task chart:', error);
    }
}

async function loadAdminSubjectPointsSummary(progress, userClass) {
    try {
        if (!userClass) return;
        
        const tasksSheetName = `${userClass}_tasks_master`;
        const tasks = await api.getSheet(tasksSheetName);
        
        if (!tasks || tasks.error || tasks.length === 0) return;
        
        // Group tasks by subject and calculate points
        const subjectStats = {};
        
        tasks.forEach(task => {
            const subject = task.subject || 'General';
            if (!subjectStats[subject]) {
                subjectStats[subject] = {
                    totalTasks: 0,
                    completedTasks: 0,
                    totalPoints: 0,
                    earnedPoints: 0
                };
            }
            
            subjectStats[subject].totalTasks++;
            
            // Check if task is completed
            const userTask = Array.isArray(progress) ? progress.find(p => 
                String(p.item_id) === String(task.task_id) && 
                p.item_type === "task" && 
                p.status === "complete"
            ) : null;
            
            if (userTask) {
                subjectStats[subject].completedTasks++;
                subjectStats[subject].earnedPoints += parseInt(userTask.grade || 0);
            }
        });
        
        // Calculate total points
        Object.keys(subjectStats).forEach(subject => {
            subjectStats[subject].totalPoints = subjectStats[subject].earnedPoints;
        });
        
        // Create or find the subject points container in admin status
        let subjectPointsContainer = document.getElementById('adminSubjectPointsGrid');
        if (!subjectPointsContainer) {
            // Create the subject points section after the task chart
            const taskChartContainer = document.getElementById('adminTaskChart')?.closest('.bg-gray-50');
            if (taskChartContainer) {
                const subjectPointsSection = document.createElement('div');
                subjectPointsSection.className = 'bg-gray-50 rounded-lg p-3 md:p-4';
                subjectPointsSection.innerHTML = `
                    <h3 class="text-base md:text-lg font-bold mb-3 md:mb-4 text-blue-600">Subject Points Summary</h3>
                    <div id="adminSubjectPointsGrid" class="subject-points-grid"></div>
                `;
                taskChartContainer.parentNode.insertBefore(subjectPointsSection, taskChartContainer.nextSibling);
                subjectPointsContainer = document.getElementById('adminSubjectPointsGrid');
            }
        }
        
        if (!subjectPointsContainer) return;
        
        const subjectCardsHtml = Object.entries(subjectStats).map(([subject, stats]) => {
            return `
                <div class="subject-points-card">
                    <div class="flex items-center justify-center mb-3">
                        <div class="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white mr-2">
                            <i class="${getSubjectIcon(subject)} text-xs md:text-sm"></i>
                        </div>
                        <h4>${subject}</h4>
                    </div>
                    <div class="points-display">${stats.earnedPoints}</div>
                    <div class="points-label">total points</div>
                    <div class="text-xs text-gray-500 mt-2">
                        ${stats.completedTasks}/${stats.totalTasks} tasks completed
                    </div>
                </div>
            `;
        }).join('');
        
        subjectPointsContainer.innerHTML = subjectCardsHtml;
        
    } catch (error) {
        console.error('Error loading admin subject points summary:', error);
    }
}

// =============================
// ➕ Add Task Functions (OPTIMIZED)
// =============================
async function openAddTaskModal() {
    const selectedClass = document.getElementById('adminTaskClassSelect').value;
    const selectedSubject = document.getElementById('adminTaskSubjectSelect').value;
    
    if (!selectedClass || !selectedSubject) {
        alert('Please select both class and subject first.');
        return;
    }
    
    try {
        const modal = document.getElementById('addTaskModal');
        const autoSubject = document.getElementById('autoSubject');
        const autoTaskId = document.getElementById('autoTaskId');
        
        // Set the auto-filled subject
        autoSubject.value = selectedSubject.charAt(0).toUpperCase() + selectedSubject.slice(1);
        
        // Generate next task ID
        const nextTaskId = await getNextTaskId(selectedClass);
        autoTaskId.value = nextTaskId;
        
        // Clear form
        document.getElementById('taskTitle').value = '';
        document.getElementById('taskDescription').value = '';
        document.getElementById('taskDueDate').value = '';
        
        modal.classList.remove('hidden');
        
    } catch (error) {
        console.error('Error opening add task modal:', error);
        alert('Error preparing to add task. Please try again.');
    }
}

function closeAddTaskModal() {
    document.getElementById('addTaskModal').classList.add('hidden');
}

async function getNextTaskId(classNum) {
    try {
        const tasksSheetName = `${classNum}_tasks_master`;
        const tasks = await api.getSheet(tasksSheetName);
        
        if (!tasks || tasks.error || tasks.length === 0) {
            return 'T1';
        }
        
        // Extract all task IDs and find the highest number
        const taskIds = tasks
            .map(task => task.task_id)
            .filter(id => id && id.startsWith('T'))
            .map(id => {
                const num = parseInt(id.substring(1));
                return isNaN(num) ? 0 : num;
            });
        
        if (taskIds.length === 0) {
            return 'T1';
        }
        
        const maxId = Math.max(...taskIds);
        return `T${maxId + 1}`;
        
    } catch (error) {
        console.error('Error generating next task ID:', error);
        return 'T1';
    }
}

async function submitAddTaskForm(event) {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    try {
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Adding Task...';
        submitBtn.disabled = true;
        
        const selectedClass = document.getElementById('adminTaskClassSelect').value;
        const selectedSubject = document.getElementById('adminTaskSubjectSelect').value;
        const taskId = document.getElementById('autoTaskId').value;
        const title = document.getElementById('taskTitle').value.trim();
        const description = document.getElementById('taskDescription').value.trim();
        const dueDate = document.getElementById('taskDueDate').value;
        
        // Validation
        if (!title || !description || !dueDate) {
            alert('Please fill in all required fields.');
            return;
        }
        
        // Format due date to DD-MM-YYYY
        const dateObj = new Date(dueDate);
        const formattedDueDate = `${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}-${dateObj.getFullYear()}`;
        // Prepare row data
        const rowData = [
            selectedSubject,
            taskId,
            title,
            description,
            formattedDueDate
        ];
        
        // Add to Google Sheet
        const tasksSheetName = `${selectedClass}_tasks_master`;
        const result = await api.addRow(tasksSheetName, rowData);
        
        if (result && (result.success || result.message?.includes('Success'))) {
            alert('Task added successfully!');
            closeAddTaskModal();
            
            // Refresh the tasks list
            await loadAdminClassSubjectData(selectedClass, selectedSubject);
        } else {
            throw new Error(result?.error || 'Failed to add task');
        }
        
    } catch (error) {
        console.error('Error adding task:', error);
        alert('Error adding task: ' + error.message);
    } finally {
        submitBtn.innerHTML = '<i class="fas fa-plus mr-2"></i>Add Task';
        submitBtn.disabled = false;
    }
}

// =============================
// 🎯 Event Listeners & Initialization (OPTIMIZED)
// =============================
document.addEventListener('DOMContentLoaded', function() {
    // Add signup form event listener
    document.getElementById('signupForm').addEventListener('submit', function(e) {
        e.preventDefault();
        submitSignup();
    });
    
    // Add login form event listener
    document.getElementById('loginForm').addEventListener('submit', function(e) {
        e.preventDefault();
        login();
    });
    
    // Modal close event listeners
    document.getElementById('studentTaskModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeStudentTaskModal();
        }
    });
    
    // Add Task Form event listener
    document.getElementById('addTaskForm').addEventListener('submit', submitAddTaskForm);
    
    // Add Task Modal close event
    document.getElementById('addTaskModal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeAddTaskModal();
        }
    });
});

// Performance optimization: Debounce resize events
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

// =============================
// 🔧 Utility Functions
// =============================
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch (e) {
        return 'Invalid Date';
    }
}

function showNotification(message, type = 'info', duration = 5000) {
    const notification = document.createElement('div');
    let bgColor = 'bg-blue-500';
    let icon = 'fas fa-info-circle';
    
    switch (type) {
        case 'success':
            bgColor = 'bg-green-500';
            icon = 'fas fa-check-circle';
            break;
        case 'error':
            bgColor = 'bg-red-500';
            icon = 'fas fa-exclamation-circle';
            break;
        case 'warning':
            bgColor = 'bg-yellow-500';
            icon = 'fas fa-exclamation-triangle';
            break;
    }
    
    notification.className = `fixed top-20 right-4 ${bgColor} text-white p-4 rounded-lg shadow-lg z-50 max-w-sm`;
    notification.innerHTML = `
        <div class="flex items-center">
            <i class="${icon} mr-2"></i>
            <span class="flex-1">${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-3 text-white hover:text-gray-200">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after duration
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, duration);
}

// =============================
// 🚀 OPTIMIZATION FUNCTIONS
// =============================

// Pre-load critical data on app start
async function preloadCriticalData() {
    if (currentUser) {
        const criticalSheets = ['user_credentials'];
        
        if (currentUser.role === 'student' && currentUser.class) {
            criticalSheets.push(
                `${currentUser.class}_tasks_master`,
                `${currentUser.username}_progress`
            );
        } else if (currentUser.role === 'admin' && currentUser.adminClasses) {
            currentUser.adminClasses.forEach(classNum => {
                criticalSheets.push(`${classNum}_tasks_master`);
            });
        }
        
        // Pre-load all critical sheets in background
        api.getBatchSheets(criticalSheets);
    }
}

// Background refresh every 2 minutes
setInterval(() => {
    if (currentUser) {
        preloadCriticalData();
    }
}, 2 * 60 * 1000);

// =============================
// 🔒 Security Functions
// =============================
// Disable right-click
document.addEventListener("contextmenu", function (e) {
    e.preventDefault();
});

// Disable common inspect shortcuts
document.addEventListener("keydown", function (e) {
    // F12
    if (e.key === "F12") {
        e.preventDefault();
    }
    // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C
    if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) {
        e.preventDefault();
    }
    // Ctrl+U (View source)
    if (e.ctrlKey && (e.key === "u" || e.key === "U")) {
        e.preventDefault();
    }
    // Ctrl+S (Save page)
    if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
    }
});

// =============================
// 🚀 Final Initialization
// =============================
// Initialize the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

function initializeApp() {
    console.log('Initializing DHDC MANOOR System...');
    
    // Set default view to login
    showLogin();
    
    console.log('System initialized successfully!');
}

// Console welcome message
console.log('%c🎓 DHDC MANOOR System Loaded Successfully! 🎓', 'color: #059669; font-size: 16px; font-weight: bold;');
console.log('%cDarul Hidaya Da\'wa College Management System', 'color: #1e40af; font-size: 12px;');

// Debug functions for testing
function debugAdminData() {
    console.log('=== ADMIN DATA DEBUG ===');
    console.log('Current User:', currentUser);
    console.log('Admin Classes:', currentUser?.adminClasses);
    console.log('Admin Subjects:', currentUser?.adminSubjects);
}

function debugCurrentUser() {
    console.log('=== CURRENT USER DEBUG ===');
    console.log('currentUser:', currentUser);
    if (currentUser) {
        console.log('Role:', currentUser.role);
        console.log('Class:', currentUser.class);
        console.log('Subjects:', currentUser.subjects);
        console.log('AdminClasses:', currentUser.adminClasses);
        console.log('AdminSubjects:', currentUser.adminSubjects);
    }
}

// =============================
// 🔐 Change Password Functions
// =============================
function openChangePasswordModal() {
    // Close profile menu first
    document.getElementById('profileMenu').classList.add('hidden');
    
    // Open change password modal
    const modal = document.getElementById('changePasswordModal');
    modal.classList.remove('hidden');
    
    // Reset form and messages
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
    
    // Hide previous messages
    errorDiv.classList.add('hidden');
    successDiv.classList.add('hidden');
    
    // Validation
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
    
    if (newPassword === currentPassword) {
        showChangePasswordError('New password must be different from current password');
        return;
    }
    
    // Show loading state
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Changing Password...';
    submitBtn.disabled = true;
    
    try {
        // Get all users to verify current password
        const users = await api.getSheet("user_credentials", false);
        
        if (!users || users.error || !Array.isArray(users)) {
            throw new Error('Failed to fetch user data');
        }
        
        // Find current user and verify current password - IMPROVED COMPARISON
const user = users.find(u => {
  if (!u.username || !u.password) return false;
  
  // Convert both to string and handle case-insensitive comparison
  const storedUsername = String(u.username).toLowerCase().trim();
  const currentUsername = String(currentUser.username).toLowerCase().trim();
  const inputPassword = String(currentPassword).trim();
  const storedPassword = String(u.password).trim();
  
  return storedUsername === currentUsername && storedPassword === inputPassword;
});
        
        if (!user) {
            throw new Error('Current password is incorrect');
        }
        
        // Update password using the API
        const updateResult = await api.updatePassword(currentUser.username, newPassword);
        
        if (updateResult && updateResult.success) {
            showChangePasswordSuccess('Password changed successfully! You will be logged out in 3 seconds.');
            document.getElementById('changePasswordForm').reset();
            
            // Logout after 3 seconds
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
        // Restore button state
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

async function updateUserPassword(username, newPassword) {
    try {
        // This function will update the password in Google Sheets
        // We need to modify our approach since we can't directly update a cell
        // We'll use the existing addRow approach but with a special identifier
        
        const rowData = [
            username,
            newPassword,
            'password_update', // Special identifier
            new Date().toISOString()
        ];
        
        const result = await api.addRow("password_updates", rowData);
        
        // For now, we'll simulate success
        // In a real implementation, you'd need to modify the Google Apps Script
        // to handle password updates properly
        return { success: true, message: 'Password update request submitted' };
        
    } catch (error) {
        console.error('Error updating password:', error);
        return { error: error.message };
    }
}

function showChangePasswordError(message) {
    const errorDiv = document.getElementById('changePasswordError');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    
    // Scroll to error message
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showChangePasswordSuccess(message) {
    const successDiv = document.getElementById('changePasswordSuccess');
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
    
    // Scroll to success message
    successDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Add event listener for change password form
document.addEventListener('DOMContentLoaded', function() {
    // Add change password form event listener
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', changePassword);
    }
    
    // Modal close event listeners
    const changePasswordModal = document.getElementById('changePasswordModal');
    if (changePasswordModal) {
        changePasswordModal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeChangePasswordModal();
            }
        });
    }
});
