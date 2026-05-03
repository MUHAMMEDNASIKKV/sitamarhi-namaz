// 🌐 Global Variables
let currentUser = null;
let currentPage = 'tasks';
let chartInstances = {};
let adminChartInstances = {};
let selectedClassForModal = null;
let selectedSubjectForModal = null;
let currentEditTaskInfo = null;

// Cache for better performance
let dataCache = {
    users: null,
    tasks: null,
    courses: null,
    events: null,
    lastUpdated: null
};

// =============================
// 📊 Google Sheets Integration
// =============================
class GoogleSheetsAPI {
    constructor() {
        this.apiUrl = "https://script.google.com/macros/s/AKfycbxU3ag0HT1ylsikdyO758qov6CLggFO-z4ZwH4P4pj3hU01dZ_RO5GHRbyhi58-FrCi/exec";
        this.cache = new Map();
        this.localCache = this.initLocalCache();
        this.cacheTimeout = 30 * 1000;
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
            
            this.cache.delete("user_credentials");
            delete this.localCache["user_credentials"];
            this.saveLocalCache();
            
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }

    // Upload file method - converts file to base64
    async uploadFile(username, taskId, file) {
        try {
            const base64Data = await this.fileToBase64(file);
            
            const payload = {
                sheet: 'uploads',
                action: 'uploadFile',
                username: username,
                taskId: taskId,
                fileName: file.name,
                fileType: file.type,
                fileData: base64Data
            };
            
            const response = await fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    data: JSON.stringify(payload)
                })
            });
            
            const result = await response.json();
            
            this.cache.delete('uploads');
            delete this.localCache['uploads'];
            this.saveLocalCache();
            
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = (error) => reject(error);
        });
    }

    // Update task points for a student
    async updateTaskPoints(username, taskId, newPoints) {
        try {
            const payload = {
                action: 'updateTaskPoints',
                username: username,
                taskId: taskId,
                points: newPoints
            };
            
            const response = await fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    data: JSON.stringify(payload)
                })
            });
            
            const result = await response.json();
            
            this.cache.delete(`${username}_progress`);
            delete this.localCache[`${username}_progress`];
            this.saveLocalCache();
            
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }

    // Mark task as complete with specific points
    async markTaskComplete(username, taskId, points) {
        try {
            const rowData = [
                taskId,
                "task",
                "complete",
                new Date().toISOString().split('T')[0],
                points.toString()
            ];
            
            return await this.addRow(`${username}_progress`, rowData);
        } catch (error) {
            return { error: error.message };
        }
    }

    // Get uploads for a specific user
    async getUserUploads(username) {
        try {
            const allUploads = await this.getSheet('uploads', false);
            if (!allUploads || allUploads.error || !Array.isArray(allUploads)) {
                return [];
            }
            
            return allUploads.filter(upload => 
                String(upload.username).toLowerCase().trim() === String(username).toLowerCase().trim()
            );
        } catch (error) {
            console.error('Error getting user uploads:', error);
            return [];
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

    const loginBtn = document.querySelector('#loginForm button[type="submit"]');
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
                
                Promise.all([
                    loadAdminData(),
                    showPage('adminTasks')
                ]);
            } else {
                document.getElementById('studentNav').classList.remove('hidden');
                document.getElementById('adminNav').classList.add('hidden');
                
                Promise.all([
                    loadTasks(),
                    showPage('tasks')
                ]);
            }
            
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
    currentEditTaskInfo = null;
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
               (page === 'adminStatus' && btnText.includes('all status')) ||
               (page === 'adminUploads' && btnText.includes('uploads'));
    });
    
    if (clickedBtn) {
        if (currentUser && currentUser.role === 'admin') {
            clickedBtn.classList.add('border-blue-500', 'text-blue-600');
        } else {
            clickedBtn.classList.add('border-green-500', 'text-green-600');
        }
    }

    currentPage = page;

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
    } else if (page === 'adminUploads') {
        await loadAdminUploadsPage();
    }
}

// =============================
// ✏️ Edit Points Modal Functions
// =============================
function openEditPointsModal(username, fullName, taskId, taskTitle, currentPoints, completed, classNum) {
    const modal = document.getElementById('editPointsModal');
    const content = document.getElementById('editPointsContent');
    const saveBtn = document.querySelector('#editPointsModal .bg-blue-600');
    
    currentEditTaskInfo = {
        username,
        fullName,
        taskId,
        taskTitle,
        currentPoints,
        completed,
        classNum,
        multiEdit: false
    };
    
    // Reset save button
    saveBtn.onclick = submitEditedPoints;
    saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Changes';
    
    document.getElementById('editPointsError').classList.add('hidden');
    document.getElementById('editPointsSuccess').classList.add('hidden');
    
    content.innerHTML = `
        <div class="space-y-4">
            <div class="bg-blue-50 rounded-lg p-3">
                <p class="text-sm text-blue-800"><strong>Student:</strong> ${fullName}</p>
                <p class="text-sm text-blue-800"><strong>Task:</strong> ${taskTitle}</p>
                <p class="text-sm text-blue-800"><strong>Task ID:</strong> ${taskId}</p>
                <p class="text-sm text-blue-800"><strong>Current Status:</strong> ${completed ? 'Completed (' + currentPoints + '/30)' : 'Not Completed'}</p>
            </div>
            
            <div>
                <label for="editPointsInput" class="block text-sm font-medium text-gray-700 mb-2">
                    Points (0-30) *
                </label>
                <input type="number" 
                       id="editPointsInput" 
                       min="0" 
                       max="30" 
                       value="${completed ? currentPoints : ''}"
                       class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-300"
                       placeholder="${completed ? 'Enter new points' : 'Enter points to complete task'}">
                <p class="text-xs text-gray-500 mt-1">Points range: 0-30</p>
            </div>
            
            ${completed ? `
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <p class="text-sm text-yellow-800">
                        <i class="fas fa-info-circle mr-1"></i>
                        This task is already completed. Updating will modify the existing points.
                    </p>
                </div>
            ` : `
                <div class="bg-green-50 border border-green-200 rounded-lg p-3">
                    <p class="text-sm text-green-800">
                        <i class="fas fa-info-circle mr-1"></i>
                        This task is not yet completed. Saving will mark it as complete.
                    </p>
                </div>
            `}
        </div>
    `;
    
    modal.classList.remove('hidden');
}

function closeEditPointsModal() {
    document.getElementById('editPointsModal').classList.add('hidden');
    currentEditTaskInfo = null;
    document.getElementById('editPointsError').classList.add('hidden');
    document.getElementById('editPointsSuccess').classList.add('hidden');
}

async function submitEditedPoints() {
    const pointsInput = document.getElementById('editPointsInput');
    const errorDiv = document.getElementById('editPointsError');
    const successDiv = document.getElementById('editPointsSuccess');
    const submitBtn = document.querySelector('#editPointsModal .bg-blue-600');
    
    errorDiv.classList.add('hidden');
    successDiv.classList.add('hidden');
    
    const points = parseInt(pointsInput.value);
    
    if (isNaN(points) || points < 0 || points > 30) {
        showEditPointsError('Please enter valid points between 0 and 30');
        return;
    }
    
    if (!currentEditTaskInfo) {
        showEditPointsError('No task selected for editing');
        return;
    }
    
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
    submitBtn.disabled = true;
    
    try {
        const { username, taskId, completed } = currentEditTaskInfo;
        
        let result;
        
        if (completed) {
            result = await api.updateTaskPoints(username, taskId, points);
        } else {
            result = await api.markTaskComplete(username, taskId, points);
        }
        
        if (result && result.success) {
            showEditPointsSuccess('Points updated successfully!');
            
            setTimeout(async () => {
                const selectedClass = document.getElementById('adminTaskClassSelect').value;
                const selectedSubject = document.getElementById('adminTaskSubjectSelect').value;
                if (selectedClass && selectedSubject) {
                    await loadAdminClassSubjectData(selectedClass, selectedSubject);
                }
                
                // If user is viewing as multi-edit, refresh that too
                if (currentEditTaskInfo && currentEditTaskInfo.multiEdit) {
                    await openEditPointsForStudent(username, currentEditTaskInfo.fullName, currentEditTaskInfo.classNum);
                }
            }, 1000);
            
            setTimeout(() => {
                closeEditPointsModal();
            }, 2000);
        } else {
            throw new Error(result?.error || 'Failed to update points');
        }
    } catch (error) {
        console.error('Error updating points:', error);
        showEditPointsError('Error: ' + error.message);
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function showEditPointsError(message) {
    const errorDiv = document.getElementById('editPointsError');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    errorDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showEditPointsSuccess(message) {
    const successDiv = document.getElementById('editPointsSuccess');
    successDiv.textContent = message;
    successDiv.classList.remove('hidden');
    successDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// =============================
// 📤 File Upload Functions
// =============================
async function triggerFileUpload(taskId, taskTitle) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.className = 'file-input-hidden';
    
    input.onchange = async function(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            alert('Please select a PDF file only.');
            return;
        }
        
        if (file.size > 10 * 1024 * 1024) {
            alert('File size must be less than 10MB.');
            return;
        }
        
        await uploadFileToTask(taskId, taskTitle, file);
    };
    
    input.click();
}

async function uploadFileToTask(taskId, taskTitle, file) {
    const uploadStatusEl = document.getElementById(`upload-status-${taskId}`);
    const uploadBtnEl = document.getElementById(`upload-btn-${taskId}`);
    
    if (!uploadStatusEl || !uploadBtnEl) return;
    
    uploadBtnEl.disabled = true;
    uploadBtnEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Uploading...';
    uploadStatusEl.innerHTML = `
        <span class="upload-status uploading">
            <i class="fas fa-spinner fa-spin mr-1"></i>Uploading...
        </span>
    `;
    
    try {
        const result = await api.uploadFile(currentUser.username, taskId, file);
        
        console.log('Upload result:', result);
        
        if (result && result.success) {
            uploadBtnEl.classList.add('uploaded');
            uploadBtnEl.innerHTML = '<i class="fas fa-check mr-1"></i>Uploaded';
            uploadBtnEl.disabled = true;
            uploadStatusEl.innerHTML = `
                <span class="upload-status success">
                    <i class="fas fa-check-circle mr-1"></i>Uploaded successfully
                </span>
            `;
            
            // REMOVED: checkAndCompleteTask - No longer auto-completing tasks on upload
            showNotification('File uploaded successfully! Points will be assigned by admin.', 'success');
        } else if (result && result.error === 'already_uploaded') {
            alert('You have already uploaded a file for this task. Please contact admin to re-upload.');
            uploadStatusEl.innerHTML = `
                <span class="upload-status error">
                    <i class="fas fa-exclamation-circle mr-1"></i>Already uploaded
                </span>
            `;
            uploadBtnEl.classList.add('uploaded');
            uploadBtnEl.innerHTML = '<i class="fas fa-check mr-1"></i>Uploaded';
            uploadBtnEl.disabled = true;
        } else {
            throw new Error(result?.error || 'Upload failed. Please try again.');
        }
    } catch (error) {
        console.error('Error uploading file:', error);
        uploadBtnEl.disabled = false;
        uploadBtnEl.innerHTML = '<i class="fas fa-upload mr-1"></i>Upload PDF';
        uploadStatusEl.innerHTML = `
            <span class="upload-status error">
                <i class="fas fa-exclamation-circle mr-1"></i>Error: ${error.message}
            </span>
        `;
        showNotification('Error uploading file: ' + error.message, 'error');
    }
}

// =============================
// ✅ Tasks (Student View)
// =============================
async function loadTasks() {
    const tasksContainer = document.getElementById('subjectCards');
    
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
            
            const [tasks, progress, uploads] = await Promise.all([
                api.getSheet(`${currentUser.class}_tasks_master`),
                api.getSheet(`${currentUser.username}_progress`),
                api.getUserUploads(currentUser.username)
            ]);
            
            if (!tasks || tasks.error || tasks.length === 0) {
                tasksContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No tasks found for your class.</p>';
                return;
            }

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

            const uploadsMap = new Map();
            if (Array.isArray(uploads)) {
                uploads.forEach(u => {
                    uploadsMap.set(String(u.task_id), {
                        uploaded: true,
                        fileUrl: u.file_url,
                        fileName: u.file_name
                    });
                });
            }

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
                
                const uploadInfo = uploadsMap.get(String(task.task_id));
                const hasUpload = uploadInfo && uploadInfo.uploaded;
                
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
                    }),
                    hasUpload,
                    uploadInfo
                });
            });

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
                                    ${task.completed && task.grade ? `<span class="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Score: ${task.grade}/30</span>` : ''}
                                </div>
                                
                                <div class="upload-section">
                                    <div class="flex items-center justify-between flex-wrap gap-2">
                                        ${task.hasUpload ? `
                                            <button class="upload-btn uploaded" disabled>
                                                <i class="fas fa-check mr-1"></i>Uploaded
                                            </button>
                                            <a href="${task.uploadInfo.fileUrl}" target="_blank" class="view-btn">
                                                <i class="fas fa-eye mr-1"></i>View PDF
                                            </a>
                                        ` : `
                                            <button onclick="triggerFileUpload('${task.task_id}', '${escapeHtml(task.title)}')" 
                                                    class="upload-btn" 
                                                    id="upload-btn-${task.task_id}">
                                                <i class="fas fa-upload mr-1"></i>Upload PDF
                                            </button>
                                        `}
                                        <span id="upload-status-${task.task_id}" class="upload-status ${task.hasUpload ? 'success' : ''}">
                                            ${task.hasUpload ? '<i class="fas fa-check-circle mr-1"></i>Uploaded successfully' : ''}
                                        </span>
                                    </div>
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function toggleSubjectTasks(subject) {
    const tasksContainer = document.getElementById(`tasks-${subject}`);
    const arrow = document.getElementById(`arrow-${subject}`);
    
    if (tasksContainer && arrow) {
        if (!tasksContainer.classList.contains('expanded')) {
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
            
            tasksContainer.classList.add('expanded');
            arrow.classList.add('expanded');
        } else {
            tasksContainer.classList.remove('expanded');
            arrow.classList.remove('expanded');
        }
    }
}

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
// 📊 Status Charts & Progress
// =============================
async function loadStatusCharts() {
    try {
        const progress = await api.getSheet(`${currentUser.username}_progress`);
        
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
        
        const tasks = await api.getSheet(`${currentUser.class}_tasks_master`);
        
        if (!tasks || tasks.error || tasks.length === 0) return;
        
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
        
        Object.keys(subjectStats).forEach(subject => {
            subjectStats[subject].totalPoints = subjectStats[subject].earnedPoints;
        });
        
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
        const tasks = await api.getSheet(`${currentUser.class}_tasks_master`);
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
            
            const taskSheetPromises = adminClasses.map(classNum => 
                api.getSheet(`${classNum}_tasks_master`).then(tasks => ({
                    classNum,
                    tasks: tasks && Array.isArray(tasks) ? tasks : []
                }))
            );
            
            const taskResults = await Promise.all(taskSheetPromises);
            
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
    
    adminTaskClassSelect.innerHTML = '<option value="">-- Select Class --</option>';
    adminTaskSubjectSelect.innerHTML = '<option value="">-- Select Subject --</option>';
    adminTaskSubjectSelect.disabled = true;
    
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
    
    adminTaskClassSelect.removeEventListener('change', handleClassChange);
    adminTaskSubjectSelect.removeEventListener('change', handleSubjectChange);
    
    adminTaskClassSelect.addEventListener('change', handleClassChange);
    adminTaskSubjectSelect.addEventListener('change', handleSubjectChange);
}

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
        document.getElementById('adminTasksDefaultView').classList.add('hidden');
        document.getElementById('adminTasksClassSubjectView').classList.remove('hidden');
        
        document.getElementById('selectedClassSubjectInfo').textContent = `Class ${classNum} - ${subject.charAt(0).toUpperCase() + subject.slice(1)}`;
        
        const [tasks, users] = await Promise.all([
            api.getSheet(`${classNum}_tasks_master`),
            api.getSheet("user_credentials")
        ]);
        
        const adminClassSubjectTasksList = document.getElementById('adminClassSubjectTasksList');
        
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
        
        // Load students
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
        
        const classStudents = users.filter(user => 
            user.role === 'student' && String(user.class) === String(classNum)
        );
        
        if (classStudents.length === 0) {
            adminClassStudentsList.innerHTML = `<p class="text-gray-500 text-center py-8">No students found in Class ${classNum}.</p>`;
            return;
        }
        
        // Load progress for all students in parallel
        const progressPromises = classStudents.map(async (student) => {
            const progress = await api.getSheet(`${student.username}_progress`);
            return {
                username: student.username,
                progress: progress && Array.isArray(progress) ? progress : []
            };
        });
        
        const allProgress = await Promise.all(progressPromises);
        const progressMap = {};
        allProgress.forEach(p => {
            progressMap[p.username] = p.progress;
        });
        
        const studentsHtml = classStudents.map(student => {
            const initials = student.full_name ? 
                student.full_name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2) : 
                student.username.substring(0, 2).toUpperCase();
            
            // Calculate completed tasks and points for this class-subject
            const studentProgress = progressMap[student.username] || [];
            const completedTasks = studentProgress.filter(p => 
                p.item_type === "task" && p.status === "complete"
            );
            
            const totalPoints = completedTasks.reduce((sum, p) => sum + (parseInt(p.grade) || 0), 0);
            
            return `
                <div class="student-card">
                    <div class="student-avatar">${initials}</div>
                    <div class="student-name">${student.full_name || student.username}</div>
                    <div class="student-username">@${student.username}</div>
                    <div class="student-class">Class ${student.class}</div>
                    <div class="text-xs text-gray-600 mt-2">
                        ${completedTasks.length} tasks • ${totalPoints} points
                    </div>
                    <div class="mt-3">
                        <button onclick="event.stopPropagation(); openEditPointsForStudent('${student.username}', '${student.full_name || student.username}', '${classNum}')" 
                                class="edit-points-btn">
                            <i class="fas fa-edit mr-1"></i>Edit Points
                        </button>
                    </div>
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

// Open edit points modal for a student showing all their tasks
async function openEditPointsForStudent(username, fullName, classNum) {
    try {
        const modal = document.getElementById('editPointsModal');
        const content = document.getElementById('editPointsContent');
        const saveBtn = document.querySelector('#editPointsModal .bg-blue-600');
        
        currentEditTaskInfo = {
            username,
            fullName,
            classNum,
            multiEdit: true
        };
        
        // Change save button to "Done" for multi-edit mode
        saveBtn.onclick = function() {
            closeEditPointsModal();
            const selectedClass = document.getElementById('adminTaskClassSelect').value;
            const selectedSubject = document.getElementById('adminTaskSubjectSelect').value;
            if (selectedClass && selectedSubject) {
                loadAdminClassSubjectData(selectedClass, selectedSubject);
            }
        };
        saveBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Done';
        
        document.getElementById('editPointsError').classList.add('hidden');
        document.getElementById('editPointsSuccess').classList.add('hidden');
        
        content.innerHTML = `
            <div class="space-y-3">
                <div class="bg-blue-50 rounded-lg p-3">
                    <p class="text-sm text-blue-800"><strong>Student:</strong> ${fullName}</p>
                    <p class="text-sm text-blue-800"><strong>Class:</strong> ${classNum}</p>
                </div>
                <p class="text-xs text-gray-500">
                    <i class="fas fa-spinner fa-spin mr-1"></i>Loading tasks...
                </p>
            </div>
        `;
        
        modal.classList.remove('hidden');
        
        const [tasks, progress] = await Promise.all([
            api.getSheet(`${classNum}_tasks_master`),
            api.getSheet(`${username}_progress`)
        ]);
        
        if (!tasks || tasks.error || tasks.length === 0) {
            content.innerHTML = `
                <div class="space-y-3">
                    <div class="bg-blue-50 rounded-lg p-3">
                        <p class="text-sm text-blue-800"><strong>Student:</strong> ${fullName}</p>
                    </div>
                    <p class="text-gray-500 text-center py-4">No tasks found for this student's class.</p>
                </div>
            `;
            return;
        }
        
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
        
        // Build task list with edit inputs
        const tasksBySubject = {};
        tasks.forEach(task => {
            const subject = task.subject || 'General';
            if (!tasksBySubject[subject]) {
                tasksBySubject[subject] = [];
            }
            tasksBySubject[subject].push(task);
        });
        
        let tasksHtml = '';
        
        Object.entries(tasksBySubject).forEach(([subject, subjectTasks]) => {
            tasksHtml += `
                <div class="mb-4">
                    <h4 class="text-sm font-bold text-blue-700 mb-2 bg-blue-50 p-2 rounded">${subject}</h4>
            `;
            
            subjectTasks.forEach(task => {
                const userProgress = progressMap.get(String(task.task_id));
                const completed = !!userProgress;
                const currentPoints = userProgress?.grade || 0;
                
                tasksHtml += `
                    <div class="admin-task-item ${completed ? 'completed' : ''} mb-2">
                        <div class="flex items-start justify-between">
                            <div class="flex-1">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="task-id-badge">${task.task_id}</span>
                                    <span class="text-xs ${completed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'} px-2 py-1 rounded">
                                        ${completed ? `Completed (${currentPoints}/30)` : 'Not Completed'}
                                    </span>
                                </div>
                                <h4 class="task-title text-sm">${task.title}</h4>
                                
                                <div class="mt-3 flex items-center gap-3">
                                    <label class="text-xs font-medium text-gray-700">Points (0-30):</label>
                                    <input type="number" 
                                           class="grade-input edit-task-points-input"
                                           data-task-id="${task.task_id}"
                                           min="0" 
                                           max="30" 
                                           value="${completed ? currentPoints : ''}"
                                           style="width: 80px;"
                                           placeholder="Points">
                                    <button onclick="updateOrCompleteTask('${task.task_id}', ${completed}, this)" 
                                            class="edit-points-btn text-xs">
                                        <i class="fas fa-save mr-1"></i>${completed ? 'Update' : 'Complete'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });
            
            tasksHtml += `</div>`;
        });
        
        content.innerHTML = `
            <div class="space-y-3 max-h-96 overflow-y-auto">
                <div class="bg-blue-50 rounded-lg p-3 sticky top-0 z-10">
                    <p class="text-sm text-blue-800"><strong>Student:</strong> ${fullName}</p>
                    <p class="text-sm text-blue-800"><strong>Class:</strong> ${classNum}</p>
                    <p class="text-xs text-blue-600 mt-1">Total Tasks: ${tasks.length}</p>
                </div>
                ${tasksHtml}
            </div>
        `;
        
    } catch (error) {
        console.error('Error opening edit points for student:', error);
        document.getElementById('editPointsContent').innerHTML = '<p class="text-red-500 text-center py-4">Error loading tasks. Please try again.</p>';
    }
}

// Combined function to update or complete a task from the multi-edit modal
async function updateOrCompleteTask(taskId, completed, button) {
    const container = button.closest('.admin-task-item') || button.closest('.flex.items-start');
    const pointsInput = container.querySelector(`input[data-task-id="${taskId}"]`) || 
                       document.querySelector(`input[data-task-id="${taskId}"]`);
    
    const points = parseInt(pointsInput.value);
    
    if (isNaN(points) || points < 0 || points > 30) {
        alert('Please enter valid points between 0 and 30');
        return;
    }
    
    const originalText = button.innerHTML;
    button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    button.disabled = true;
    
    try {
        let result;
        
        if (completed) {
            result = await api.updateTaskPoints(currentEditTaskInfo.username, taskId, points);
        } else {
            result = await api.markTaskComplete(currentEditTaskInfo.username, taskId, points);
        }
        
        if (result && result.success) {
            showNotification(`Task points ${completed ? 'updated' : 'assigned'} successfully!`, 'success');
            
            // Refresh the multi-edit view
            await openEditPointsForStudent(
                currentEditTaskInfo.username, 
                currentEditTaskInfo.fullName, 
                currentEditTaskInfo.classNum
            );
        } else {
            throw new Error(result?.error || 'Failed to update points');
        }
    } catch (error) {
        console.error('Error updating task:', error);
        alert('Error: ' + error.message);
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
}

async function openStudentTaskModal(username, fullName, classNum) {
    try {
        const modal = document.getElementById('studentTaskModal');
        const title = document.getElementById('studentTaskModalTitle');
        const content = document.getElementById('studentTaskModalContent');
        
        title.textContent = `Tasks for ${fullName} - ${selectedSubjectForModal}`;
        
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
        
        const [progress, tasks] = await Promise.all([
            api.getSheet(`${username}_progress`),
            api.getSheet(`${classNum}_tasks_master`)
        ]);
        
        if (!tasks || tasks.error || tasks.length === 0) {
            content.innerHTML = '<p class="text-gray-500 text-center py-8">No tasks found for this class.</p>';
            return;
        }
        
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
        document.getElementById('studentTaskModalContent').innerHTML = '<p class="text-red-500 text-center py-8">Error loading student tasks. Please try again.</p>';
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
        userSelect.innerHTML = '<option value="">-- Error Loading Users --</option>';
    }
}

async function loadSelectedUserStatus(username) {
    try {
        const [users, progress] = await Promise.all([
            api.getSheet("user_credentials"),
            api.getSheet(`${username}_progress`)
        ]);
        
        const user = users.find(u => u.username === username);
        
        if (!user) {
            alert('User not found!');
            return;
        }
        
        document.getElementById('selectedUserName').textContent = user.full_name || user.username;
        document.getElementById('selectedUserInfo').textContent = `Username: ${user.username} | Class: ${user.class || 'Not Assigned'} | Role: ${user.role}`;
        
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
        const tasks = await api.getSheet(`${userClass}_tasks_master`);
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
        
        const tasks = await api.getSheet(`${userClass}_tasks_master`);
        
        if (!tasks || tasks.error || tasks.length === 0) return;
        
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
        
        Object.keys(subjectStats).forEach(subject => {
            subjectStats[subject].totalPoints = subjectStats[subject].earnedPoints;
        });
        
        let subjectPointsContainer = document.getElementById('adminSubjectPointsGrid');
        if (!subjectPointsContainer) {
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
// 📤 Admin Uploads Page
// =============================
async function loadAdminUploadsPage() {
    try {
        const uploadUserSelect = document.getElementById('uploadUserSelect');
        const noUploadUserSelected = document.getElementById('noUploadUserSelected');
        const selectedUserUploads = document.getElementById('selectedUserUploads');
        
        uploadUserSelect.innerHTML = '<option value="">-- Loading Users... --</option>';
        
        const users = await api.getSheet("user_credentials");
        
        uploadUserSelect.innerHTML = '<option value="">-- Select Student --</option>';
        
        if (users && Array.isArray(users)) {
            const students = users.filter(user => user.role === 'student');
            students.forEach(student => {
                const option = document.createElement('option');
                option.value = student.username;
                option.textContent = `${student.full_name || student.username} (Class ${student.class || 'N/A'})`;
                uploadUserSelect.appendChild(option);
            });
        }
        
        const newUploadUserSelect = uploadUserSelect.cloneNode(true);
        uploadUserSelect.parentNode.replaceChild(newUploadUserSelect, uploadUserSelect);
        
        document.getElementById('uploadUserSelect').addEventListener('change', async function() {
            const selectedUsername = this.value;
            
            if (selectedUsername) {
                noUploadUserSelected.classList.add('hidden');
                selectedUserUploads.classList.remove('hidden');
                await loadUserUploads(selectedUsername);
            } else {
                noUploadUserSelected.classList.remove('hidden');
                selectedUserUploads.classList.add('hidden');
            }
        });
        
        noUploadUserSelected.classList.remove('hidden');
        selectedUserUploads.classList.add('hidden');
        
    } catch (error) {
        console.error('Error loading admin uploads page:', error);
        uploadUserSelect.innerHTML = '<option value="">-- Error Loading Users --</option>';
    }
}

async function loadUserUploads(username) {
    try {
        const [users, uploads] = await Promise.all([
            api.getSheet("user_credentials"),
            api.getUserUploads(username)
        ]);
        
        const user = users.find(u => u.username === username);
        
        if (!user) {
            alert('User not found!');
            return;
        }
        
        document.getElementById('uploadUserName').textContent = user.full_name || user.username;
        document.getElementById('uploadUserInfo').textContent = `Username: ${user.username} | Class: ${user.class || 'Not Assigned'}`;
        
        const uploadTasksList = document.getElementById('uploadTasksList');
        
        if (!uploads || uploads.length === 0) {
            uploadTasksList.innerHTML = `
                <div class="text-center py-8">
                    <i class="fas fa-file-pdf text-4xl text-gray-300 mb-3"></i>
                    <p class="text-gray-500">No uploads found for this student.</p>
                </div>
            `;
            return;
        }
        
        let tasks = [];
        if (user.class) {
            const tasksData = await api.getSheet(`${user.class}_tasks_master`);
            if (tasksData && Array.isArray(tasksData)) {
                tasks = tasksData;
            }
        }
        
        const tasksMap = new Map();
        tasks.forEach(task => {
            tasksMap.set(String(task.task_id), task);
        });
        
        const uploadsHtml = uploads.map(upload => {
            const task = tasksMap.get(String(upload.task_id));
            const taskTitle = task ? task.title : 'Unknown Task';
            const taskSubject = task ? task.subject : 'Unknown Subject';
            const uploadDate = upload.upload_date || 'Unknown Date';
            
            return `
                <div class="admin-task-item">
                    <div class="flex items-start justify-between">
                        <div class="flex-1">
                            <div class="flex items-center justify-between mb-2">
                                <span class="task-id-badge">${upload.task_id}</span>
                                <span class="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">${taskSubject}</span>
                            </div>
                            <h4 class="task-title">${taskTitle}</h4>
                            <p class="text-sm text-gray-600 mb-2">
                                <i class="fas fa-file-pdf mr-1 text-red-500"></i>
                                ${upload.file_name || 'uploaded_file.pdf'}
                            </p>
                            <p class="text-xs text-gray-500 mb-3">
                                <i class="fas fa-calendar-alt mr-1"></i>Uploaded: ${uploadDate}
                            </p>
                            <div class="flex items-center gap-2">
                                <a href="${upload.file_url}" target="_blank" class="view-btn">
                                    <i class="fas fa-eye mr-1"></i>View PDF
                                </a>
                                <a href="${upload.file_url}" download class="download-btn">
                                    <i class="fas fa-download mr-1"></i>Download
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        uploadTasksList.innerHTML = uploadsHtml;
        
    } catch (error) {
        console.error('Error loading user uploads:', error);
        uploadTasksList.innerHTML = '<p class="text-red-500 text-center py-8">Error loading uploads. Please try again.</p>';
    }
}

// =============================
// ➕ Add Task Functions
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
        document.getElementById('autoSubject').value = selectedSubject.charAt(0).toUpperCase() + selectedSubject.slice(1);
        document.getElementById('autoTaskId').value = await getNextTaskId(selectedClass);
        
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
        const tasks = await api.getSheet(`${classNum}_tasks_master`);
        
        if (!tasks || tasks.error || tasks.length === 0) {
            return 'T1';
        }
        
        const taskIds = tasks
            .map(task => task.task_id)
            .filter(id => id && id.startsWith('T'))
            .map(id => {
                const num = parseInt(id.substring(1));
                return isNaN(num) ? 0 : num;
            });
        
        if (taskIds.length === 0) return 'T1';
        
        return `T${Math.max(...taskIds) + 1}`;
        
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
        
        if (!title || !description || !dueDate) {
            alert('Please fill in all required fields.');
            return;
        }
        
        const dateObj = new Date(dueDate);
        const formattedDueDate = `${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}-${dateObj.getFullYear()}`;
        
        const rowData = [selectedSubject, taskId, title, description, formattedDueDate];
        
        const result = await api.addRow(`${selectedClass}_tasks_master`, rowData);
        
        if (result && (result.success || result.message?.includes('Success'))) {
            alert('Task added successfully!');
            closeAddTaskModal();
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
    
    document.getElementById('studentTaskModal').addEventListener('click', function(e) {
        if (e.target === this) closeStudentTaskModal();
    });
    
    document.getElementById('addTaskForm').addEventListener('submit', submitAddTaskForm);
    
    document.getElementById('addTaskModal').addEventListener('click', function(e) {
        if (e.target === this) closeAddTaskModal();
    });
    
    document.getElementById('editPointsModal').addEventListener('click', function(e) {
        if (e.target === this) closeEditPointsModal();
    });
    
    const changePasswordForm = document.getElementById('changePasswordForm');
    if (changePasswordForm) {
        changePasswordForm.addEventListener('submit', changePassword);
    }
    
    const changePasswordModal = document.getElementById('changePasswordModal');
    if (changePasswordModal) {
        changePasswordModal.addEventListener('click', function(e) {
            if (e.target === this) closeChangePasswordModal();
        });
    }
});

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
        return new Date(dateString).toLocaleDateString('en-US', {
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
    const colors = {
        success: { bg: 'bg-green-500', icon: 'fas fa-check-circle' },
        error: { bg: 'bg-red-500', icon: 'fas fa-exclamation-circle' },
        warning: { bg: 'bg-yellow-500', icon: 'fas fa-exclamation-triangle' },
        info: { bg: 'bg-blue-500', icon: 'fas fa-info-circle' }
    };
    
    const { bg: bgColor, icon } = colors[type] || colors.info;
    
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
    
    setTimeout(() => {
        if (notification.parentElement) notification.remove();
    }, duration);
}

async function preloadCriticalData() {
    if (currentUser) {
        const criticalSheets = ['user_credentials'];
        
        if (currentUser.role === 'student' && currentUser.class) {
            criticalSheets.push(`${currentUser.class}_tasks_master`, `${currentUser.username}_progress`);
        } else if (currentUser.role === 'admin' && currentUser.adminClasses) {
            currentUser.adminClasses.forEach(classNum => {
                criticalSheets.push(`${classNum}_tasks_master`);
            });
        }
        
        api.getBatchSheets(criticalSheets);
    }
}

setInterval(() => {
    if (currentUser) preloadCriticalData();
}, 2 * 60 * 1000);

document.addEventListener("contextmenu", function (e) { e.preventDefault(); });

document.addEventListener("keydown", function (e) {
    if (e.key === "F12") e.preventDefault();
    if (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) e.preventDefault();
    if (e.ctrlKey && (e.key === "u" || e.key === "U")) e.preventDefault();
    if (e.ctrlKey && (e.key === "s" || e.key === "S")) e.preventDefault();
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

function initializeApp() {
    console.log('Initializing System...');
    showLogin();
    console.log('System initialized successfully!');
}

console.log('%c🎓 System Loaded Successfully! 🎓', 'color: #059669; font-size: 16px; font-weight: bold;');

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
    document.getElementById('profileMenu').classList.add('hidden');
    document.getElementById('changePasswordModal').classList.remove('hidden');
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
    
    if (newPassword === currentPassword) {
        showChangePasswordError('New password must be different from current password');
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
            return String(u.username).toLowerCase().trim() === String(currentUser.username).toLowerCase().trim() && 
                   String(u.password).trim() === String(currentPassword).trim();
        });
        
        if (!user) {
            throw new Error('Current password is incorrect');
        }
        
        const updateResult = await api.updatePassword(currentUser.username, newPassword);
        
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
