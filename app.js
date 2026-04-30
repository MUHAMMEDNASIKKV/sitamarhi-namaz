// ============================================
// THARBIYYA - Prayer Tracker
// 5 Daily Prayers Tracker + Rawatib
// Values: Adā' = 2, Qaḍā' = 1, No = 0
// Rawatib: Yes = 1, No = 0
// Order: Subh, Zuhr, Asr, Magrib, Isha
// ============================================

// 🌐 Global Variables
let currentUser = null;
let currentClassSheet = null;
let currentDate = null;
let usersDataCache = null; // Cache for user data
let isLoadingUsers = false; // Prevent multiple simultaneous loads

// Google Sheets CSV URL for user credentials
const USER_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=0&single=true&output=csv";

// Class-specific sheet URLs for checking existing submissions
const CLASS_URLS = {
    1: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=489329760&single=true&output=csv",
    2: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=428928738&single=true&output=csv",
    3: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=1221669068&single=true&output=csv",
    4: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=217652018&single=true&output=csv",
    5: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=1691881671&single=true&output=csv",
    6: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=1246984609&single=true&output=csv",
    7: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=469514472&single=true&output=csv",
    8: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=272645470&single=true&output=csv",
    9: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=1743514473&single=true&output=csv",
    10: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSOGrONCLJ53Hf3jKE7VA7ro-yZmlzc_lFy9CxKvL_8VBuXRQp7hZxLjUpy0wmf28TYAn2HQ-uaV5r/pub?gid=820085037&single=true&output=csv"
};

// Cache for submission checks to prevent repeated API calls
const submissionCache = new Map();

// =============================
// 📊 Google Sheets API Configuration
// =============================
class GoogleSheetsAPI {
    constructor() {
        // IMPORTANT: Replace this URL with your Google Apps Script Web App URL
        this.apiUrl = "https://script.google.com/macros/s/AKfycbw3VUkqEbM-YON7Xshbpb3pBMCZ6uoxuA1N6LjfBAAVXQLy2bFnbq0amPzDRfkEqyDM/exec";
    }

    async addPrayerRecord(sheetName, rowData) {
        try {
            const response = await fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    action: "addRecord",
                    sheet: sheetName,
                    data: JSON.stringify(rowData)
                })
            });
            
            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error adding record:', error);
            return { error: error.message };
        }
    }

    async ensureSheetExists(sheetName) {
        try {
            const response = await fetch(this.apiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    action: "ensureSheet",
                    sheet: sheetName
                })
            });
            
            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error ensuring sheet exists:', error);
            return { error: error.message };
        }
    }
}

const api = new GoogleSheetsAPI();

// =============================
// 📥 Load User Data from CSV (with caching)
// =============================
async function loadUsersFromCSV(forceReload = false) {
    // Return cached data if available and not forcing reload
    if (!forceReload && usersDataCache) {
        console.log('Using cached user data');
        return usersDataCache;
    }
    
    // Prevent multiple simultaneous loads
    if (isLoadingUsers) {
        console.log('Already loading users, waiting...');
        // Wait for the current load to complete
        await new Promise(resolve => {
            const checkInterval = setInterval(() => {
                if (!isLoadingUsers) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });
        return usersDataCache;
    }
    
    isLoadingUsers = true;
    
    try {
        console.log('Loading users from CSV...');
        const response = await fetch(USER_CSV_URL);
        const csvText = await response.text();
        
        // Parse CSV
        const rows = csvText.split('\n');
        const headers = rows[0].split(',');
        
        // Find column indices
        const nameIndex = headers.findIndex(h => h.toLowerCase().trim() === 'name');
        const pswdIndex = headers.findIndex(h => h.toLowerCase().trim() === 'pswd');
        const classIndex = headers.findIndex(h => h.toLowerCase().trim() === 'class');
        
        if (nameIndex === -1 || pswdIndex === -1 || classIndex === -1) {
            console.error('CSV headers not found. Expected: name, pswd, class');
            return [];
        }
        
        const users = [];
        
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].trim() === '') continue;
            
            // Parse CSV line (handling quoted values)
            let row = rows[i];
            let values = [];
            let inQuote = false;
            let currentValue = '';
            
            for (let char of row) {
                if (char === '"') {
                    inQuote = !inQuote;
                } else if (char === ',' && !inQuote) {
                    values.push(currentValue.trim());
                    currentValue = '';
                } else {
                    currentValue += char;
                }
            }
            values.push(currentValue.trim());
            
            // Remove quotes from values
            values = values.map(v => v.replace(/^"|"$/g, ''));
            
            const name = values[nameIndex];
            const pswd = values[pswdIndex];
            const userClass = values[classIndex];
            
            if (name && pswd && userClass) {
                users.push({
                    name: name,
                    password: pswd,
                    class: userClass
                });
            }
        }
        
        // Cache the data
        usersDataCache = users;
        console.log(`Loaded ${users.length} users successfully`);
        return users;
    } catch (error) {
        console.error('Error loading users from CSV:', error);
        return usersDataCache || [];
    } finally {
        isLoadingUsers = false;
    }
}

// =============================
// 🔍 Check if student already submitted today (with caching)
// =============================
async function hasStudentSubmittedToday(studentClass, studentName, date) {
    // Create cache key
    const cacheKey = `${studentClass}_${studentName}_${date}`;
    
    // Check cache first
    if (submissionCache.has(cacheKey)) {
        console.log('Using cached submission check for:', cacheKey);
        return submissionCache.get(cacheKey);
    }
    
    try {
        // Get the class-specific CSV URL
        const classUrl = CLASS_URLS[parseInt(studentClass)];
        if (!classUrl) {
            console.error('No URL found for class:', studentClass);
            return false;
        }
        
        console.log(`Checking submission for ${studentName} in class ${studentClass} on ${date}`);
        
        const response = await fetch(classUrl);
        const csvText = await response.text();
        
        // Parse CSV
        const rows = csvText.split('\n');
        if (rows.length < 2) {
            submissionCache.set(cacheKey, false);
            return false;
        }
        
        // Get headers from first row
        const headers = rows[0].split(',');
        
        // Find column indices
        const dateIndex = headers.findIndex(h => h.toLowerCase().trim() === 'date');
        const nameIndex = headers.findIndex(h => h.toLowerCase().trim() === 'name');
        
        if (dateIndex === -1 || nameIndex === -1) {
            console.error('CSV headers not found. Expected: date, name');
            return false;
        }
        
        // Check each row for matching date and name
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].trim() === '') continue;
            
            // Parse CSV line
            let row = rows[i];
            let values = [];
            let inQuote = false;
            let currentValue = '';
            
            for (let char of row) {
                if (char === '"') {
                    inQuote = !inQuote;
                } else if (char === ',' && !inQuote) {
                    values.push(currentValue.trim());
                    currentValue = '';
                } else {
                    currentValue += char;
                }
            }
            values.push(currentValue.trim());
            
            // Remove quotes from values
            values = values.map(v => v.replace(/^"|"$/g, ''));
            
            const recordDate = values[dateIndex];
            const recordName = values[nameIndex];
            
            if (recordDate === date && recordName === studentName) {
                submissionCache.set(cacheKey, true);
                return true;
            }
        }
        
        submissionCache.set(cacheKey, false);
        return false;
    } catch (error) {
        console.error('Error checking submission status:', error);
        return false;
    }
}

// =============================
// 🔑 Login Functions
// =============================

// Preload user data as soon as possible
async function preloadUserData() {
    await loadUsersFromCSV();
}

// Load student names on page load
document.addEventListener('DOMContentLoaded', async function() {
    // Show loading indicator on name dropdown
    const nameSelect = document.getElementById('studentName');
    nameSelect.innerHTML = '<option value="" disabled selected>Loading students...</option>';
    
    // Preload user data in background
    preloadUserData().then(() => {
        // Once loaded, update the dropdown message
        if (nameSelect.value === 'Loading students...') {
            nameSelect.innerHTML = '<option value="" disabled selected>-- First Select Class --</option>';
        }
    });
    
    // Set current date
    const today = new Date();
    const formattedDate = today.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    document.getElementById('currentDateDisplay').textContent = formattedDate;
    currentDate = today.toISOString().split('T')[0];
    
    // Initialize prayer option buttons
    initializePrayerOptions();
    initializeRawatibOptions();
    
    // Add login form submit listener
    document.getElementById('loginForm').addEventListener('submit', login);
    
    // Add prayer form submit listener
    document.getElementById('prayerForm').addEventListener('submit', submitPrayerForm);
    
    // Add class dropdown change listener to filter names
    document.getElementById('studentClass').addEventListener('change', filterNamesByClass);
});

// Optimized function to filter names by class with instant loading
async function filterNamesByClass() {
    const selectedClass = document.getElementById('studentClass').value;
    const nameSelect = document.getElementById('studentName');
    const passwordInput = document.getElementById('password');
    
    // Clear password field when class changes
    passwordInput.value = '';
    
    if (!selectedClass) {
        nameSelect.innerHTML = '<option value="" disabled selected>-- First Select Class --</option>';
        nameSelect.disabled = false;
        return;
    }
    
    // Show loading state
    nameSelect.innerHTML = '<option value="" disabled selected>Loading students...</option>';
    nameSelect.disabled = true;
    
    // Ensure user data is loaded
    if (!usersDataCache) {
        await loadUsersFromCSV();
    }
    
    // Use requestAnimationFrame for smoother UI update
    requestAnimationFrame(() => {
        const filteredUsers = (usersDataCache || []).filter(user => user.class === selectedClass);
        
        if (filteredUsers.length === 0) {
            nameSelect.innerHTML = '<option value="" disabled selected>-- No students found in this class --</option>';
            nameSelect.disabled = false;
        } else {
            // Use DocumentFragment for faster DOM manipulation
            const fragment = document.createDocumentFragment();
            const defaultOption = document.createElement('option');
            defaultOption.value = "";
            defaultOption.disabled = true;
            defaultOption.selected = true;
            defaultOption.textContent = "-- Select Student Name --";
            fragment.appendChild(defaultOption);
            
            filteredUsers.forEach(user => {
                const option = document.createElement('option');
                option.value = user.name;
                option.textContent = `${user.name}`;
                option.dataset.class = user.class;
                option.dataset.password = user.password;
                fragment.appendChild(option);
            });
            
            // Clear and append all at once
            nameSelect.innerHTML = '';
            nameSelect.appendChild(fragment);
            nameSelect.disabled = false;
        }
    });
}

async function login(event) {
    event.preventDefault();
    
    const selectedOption = document.getElementById('studentName').selectedOptions[0];
    const studentName = document.getElementById('studentName').value;
    const studentClass = document.getElementById('studentClass').value;
    const password = document.getElementById('password').value;
    
    // Hide previous error
    hideLoginError();
    
    if (!studentClass) {
        showLoginError('Please select a class');
        return;
    }
    
    if (!studentName) {
        showLoginError('Please select a student name');
        return;
    }
    
    if (!password) {
        showLoginError('Please enter your password');
        return;
    }
    
    // Get the stored password from the selected option
    const storedPassword = selectedOption ? selectedOption.dataset.password : null;
    
    if (!storedPassword) {
        showLoginError('Invalid student selection');
        return;
    }
    
    if (password !== storedPassword) {
        showLoginError('Invalid password');
        return;
    }
    
    // Show loading state
    const submitBtn = document.querySelector('#loginForm .submit-btn');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing In...';
    submitBtn.disabled = true;
    
    try {
        // Check if student already submitted today
        const alreadySubmitted = await hasStudentSubmittedToday(studentClass, studentName, currentDate);
        
        if (alreadySubmitted) {
            showLoginError(`You have already submitted your prayer status for today (${new Date().toLocaleDateString()}). You can only submit once per day.`);
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
            return;
        }
        
        // Login successful
        currentUser = {
            name: studentName,
            class: studentClass,
            password: password
        };
        
        // Set current sheet name based on class
        currentClassSheet = `Class_${studentClass}`;
        
        // Ensure sheet exists
        await api.ensureSheetExists(currentClassSheet);
        
        // Show dashboard
        document.getElementById('loginPage').classList.add('hidden');
        document.getElementById('dashboardPage').classList.remove('hidden');
        
        // Update UI
        document.getElementById('userNameDisplay').textContent = currentUser.name;
        document.getElementById('userClassDisplay').textContent = `Class ${currentUser.class}`;
        
        // Clear password field
        document.getElementById('password').value = '';
        
    } catch (error) {
        console.error('Login error:', error);
        showLoginError('Login failed. Please try again.');
    } finally {
        // Restore button state
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

function showLoginError(message) {
    const errorDiv = document.getElementById('loginError');
    errorDiv.querySelector('span').textContent = message;
    errorDiv.classList.remove('hidden');
}

function hideLoginError() {
    document.getElementById('loginError').classList.add('hidden');
}

function logout() {
    currentUser = null;
    currentClassSheet = null;
    
    // Reset forms
    document.getElementById('loginForm').reset();
    resetPrayerForm();
    
    // Reset name dropdown to initial state
    const nameSelect = document.getElementById('studentName');
    nameSelect.innerHTML = '<option value="" disabled selected>-- First Select Class --</option>';
    
    // Show login page
    document.getElementById('dashboardPage').classList.add('hidden');
    document.getElementById('loginPage').classList.remove('hidden');
}

// =============================
// 🕌 Prayer Form Functions
// =============================

function initializePrayerOptions() {
    // Delegate event listener for prayer options
    document.addEventListener('click', function(e) {
        const option = e.target.closest('.prayer-option');
        if (!option) return;
        
        const optionsContainer = option.closest('.prayer-options');
        if (!optionsContainer) return;
        
        // Get all options in this container
        const options = optionsContainer.querySelectorAll('.prayer-option');
        const prayerName = optionsContainer.dataset.prayer;
        
        // Remove selected class from all options
        options.forEach(opt => {
            opt.classList.remove('selected');
        });
        
        // Add selected class to clicked option
        option.classList.add('selected');
        
        // Update hidden input value with the numeric value (2, 1, or 0)
        if (prayerName) {
            const hiddenInput = document.getElementById(prayerName);
            if (hiddenInput) {
                hiddenInput.value = option.dataset.value;
                console.log(`${prayerName} set to: ${option.dataset.value} (${option.querySelector('span')?.innerText || 'Unknown'})`);
            }
        }
    });
}

function initializeRawatibOptions() {
    // Delegate event listener for rawatib options
    document.addEventListener('click', function(e) {
        const option = e.target.closest('.rawatib-option');
        if (!option) return;
        
        const optionsContainer = option.closest('.rawatib-options');
        if (!optionsContainer) return;
        
        // Get all options in this container
        const options = optionsContainer.querySelectorAll('.rawatib-option');
        const rawatibName = optionsContainer.dataset.rawatib;
        
        // Remove selected class from all options
        options.forEach(opt => {
            opt.classList.remove('selected');
        });
        
        // Add selected class to clicked option
        option.classList.add('selected');
        
        // Update hidden input value with the numeric value (1 or 0)
        if (rawatibName) {
            const hiddenInput = document.getElementById(rawatibName);
            if (hiddenInput) {
                hiddenInput.value = option.dataset.value;
                console.log(`${rawatibName} set to: ${option.dataset.value} (${option.querySelector('span')?.innerText || 'Unknown'})`);
            }
        }
    });
}

function resetPrayerForm() {
    // Reset all prayer options
    document.querySelectorAll('.prayer-options').forEach(container => {
        const options = container.querySelectorAll('.prayer-option');
        const prayerName = container.dataset.prayer;
        
        options.forEach(opt => {
            opt.classList.remove('selected');
        });
        
        // Clear hidden input
        if (prayerName) {
            const hiddenInput = document.getElementById(prayerName);
            if (hiddenInput) hiddenInput.value = '';
        }
    });
    
    // Reset all rawatib options
    document.querySelectorAll('.rawatib-options').forEach(container => {
        const options = container.querySelectorAll('.rawatib-option');
        const rawatibName = container.dataset.rawatib;
        
        options.forEach(opt => {
            opt.classList.remove('selected');
        });
        
        // Clear hidden input
        if (rawatibName) {
            const hiddenInput = document.getElementById(rawatibName);
            if (hiddenInput) hiddenInput.value = '';
        }
    });
    
    // Enable submit button
    const submitBtn = document.getElementById('submitPrayerBtn');
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fas fa-save"></i> Submit Today\'s Prayers';
}

// Custom Alert Popup with auto-logout after OK button click
function showSuccessAlertWithLogout(message, summary, onComplete) {
    // Remove any existing alert
    const existingAlert = document.querySelector('.custom-alert');
    if (existingAlert) {
        existingAlert.remove();
    }
    
    // Create alert popup
    const alertDiv = document.createElement('div');
    alertDiv.className = 'custom-alert';
    alertDiv.innerHTML = `
        <div class="custom-alert-content">
            <div class="custom-alert-icon">
                <i class="fas fa-check-circle"></i>
            </div>
            <div class="custom-alert-title">Successfully Submitted!</div>
            <div class="custom-alert-message">Your prayer status has been recorded.</div>
            <div class="custom-alert-summary">${summary}</div>
            <button class="custom-alert-btn" id="customAlertOkBtn">OK</button>
        </div>
    `;
    
    document.body.appendChild(alertDiv);
    
    // Add event listener to OK button
    const okBtn = document.getElementById('customAlertOkBtn');
    okBtn.addEventListener('click', function() {
        alertDiv.remove();
        if (onComplete) {
            onComplete();
        }
    });
}

async function submitPrayerForm(event) {
    event.preventDefault();
    
    // Get all fard prayer values (these are numeric: 2, 1, or 0)
    const subh = document.getElementById('subh').value;
    const zuhr = document.getElementById('zuhr').value;
    const asr = document.getElementById('asr').value;
    const magrib = document.getElementById('magrib').value;
    const isha = document.getElementById('isha').value;
    
    // Validate all fard prayers are selected
    if (!subh || !zuhr || !asr || !magrib || !isha) {
        alert('Please select status for all 5 Fard prayers');
        return;
    }
    
    // Get all rawatib values (these are numeric: 1 or 0, empty means not selected)
    const bSubh = document.getElementById('bSubh').value;
    const bZuhr = document.getElementById('bZuhr').value;
    const aZuhr = document.getElementById('aZuhr').value;
    const bAsr = document.getElementById('bAsr').value;
    const aMagrib = document.getElementById('aMagrib').value;
    const aIsha = document.getElementById('aIsha').value;
    
    // Validate all rawatib are selected
    if (bSubh === '' || bZuhr === '' || aZuhr === '' || bAsr === '' || aMagrib === '' || aIsha === '') {
        alert('Please select Yes/No for all Rawatib (Sunnah) prayers');
        return;
    }
    
    // Show loading state
    const submitBtn = document.getElementById('submitPrayerBtn');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
    submitBtn.disabled = true;
    
    try {
        // Get current date and time
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        const timeStr = now.toLocaleTimeString('en-GB');
        
        // Prepare row data: date, time, name, class, subh, zuhr, asr, magrib, isha, bSubh, bZuhr, aZuhr, bAsr, aMagrib, aIsha
        const rowData = [
            dateStr, 
            timeStr, 
            currentUser.name, 
            currentUser.class, 
            subh,
            zuhr,
            asr,
            magrib,
            isha,
            bSubh,
            bZuhr,
            aZuhr,
            bAsr,
            aMagrib,
            aIsha
        ];
        
        console.log('Submitting prayer data:', {
            date: dateStr,
            time: timeStr,
            name: currentUser.name,
            class: currentUser.class,
            subh: subh,
            zuhr: zuhr,
            asr: asr,
            magrib: magrib,
            isha: isha,
            bSubh: bSubh,
            bZuhr: bZuhr,
            aZuhr: aZuhr,
            bAsr: bAsr,
            aMagrib: aMagrib,
            aIsha: aIsha
        });
        
        // Add record to sheet
        const result = await api.addPrayerRecord(currentClassSheet, rowData);
        
        if (result && result.success) {
            // Clear submission cache for this student
            const cacheKey = `${currentUser.class}_${currentUser.name}_${dateStr}`;
            submissionCache.set(cacheKey, true);
            
            // Build summary for alert
            const fardSummary = `
                <strong>Fard Prayers:</strong><br>
                Subh: ${getPrayerStatusText(subh)}<br>
                Zuhr: ${getPrayerStatusText(zuhr)}<br>
                Asr: ${getPrayerStatusText(asr)}<br>
                Magrib: ${getPrayerStatusText(magrib)}<br>
                Isha: ${getPrayerStatusText(isha)}
            `;
            
            const rawatibSummary = `
                <strong>Rawatib (Sunnah):</strong><br>
                B-Subh: ${getRawatibStatusText(bSubh)}<br>
                B-Zuhr: ${getRawatibStatusText(bZuhr)}<br>
                A-Zuhr: ${getRawatibStatusText(aZuhr)}<br>
                B-Asr: ${getRawatibStatusText(bAsr)}<br>
                A-Magrib: ${getRawatibStatusText(aMagrib)}<br>
                A-Isha: ${getRawatibStatusText(aIsha)}
            `;
            
            const fullSummary = `${fardSummary}<br>${rawatibSummary}<br><br><strong>📅 Date:</strong> ${new Date().toLocaleDateString()}<br><br>You will now be logged out.`;
            
            // Show success popup and logout after OK
            showSuccessAlertWithLogout('', fullSummary, function() {
                // Clear any stored user data
                currentUser = null;
                currentClassSheet = null;
                
                // Reset forms
                document.getElementById('loginForm').reset();
                resetPrayerForm();
                
                // Reset name dropdown to initial state
                const nameSelect = document.getElementById('studentName');
                nameSelect.innerHTML = '<option value="" disabled selected>-- First Select Class --</option>';
                
                // Reset class dropdown
                const classSelect = document.getElementById('studentClass');
                classSelect.value = '';
                
                // Show login page
                document.getElementById('dashboardPage').classList.add('hidden');
                document.getElementById('loginPage').classList.remove('hidden');
                
                // Show a temporary message that they cannot login again today
                const tempMsg = document.createElement('div');
                tempMsg.className = 'error-message';
                tempMsg.style.marginTop = '1rem';
                tempMsg.style.marginBottom = '0';
                tempMsg.style.backgroundColor = '#ecfdf5';
                tempMsg.style.borderColor = '#059669';
                tempMsg.style.color = '#065f46';
                tempMsg.innerHTML = `<i class="fas fa-info-circle"></i><span>✓ You have submitted today's prayer status. You can submit again tomorrow.</span>`;
                
                const loginContainer = document.querySelector('.login-container');
                const existingMsg = loginContainer.querySelector('.temp-info-message');
                if (existingMsg) existingMsg.remove();
                
                tempMsg.classList.add('temp-info-message');
                loginContainer.appendChild(tempMsg);
                
                // Remove the message after 5 seconds
                setTimeout(() => {
                    if (tempMsg.parentNode) {
                        tempMsg.remove();
                    }
                }, 5000);
            });
        } else {
            throw new Error(result?.error || 'Failed to submit data');
        }
    } catch (error) {
        console.error('Error submitting form:', error);
        alert('Submission failed. Please try again.');
        
        // Restore button state
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

// Helper function to convert numeric value to text status
function getPrayerStatusText(value) {
    switch(value) {
        case '2':
            return '✅ Adā\' (Prayed on time)';
        case '1':
            return '🕐 Qaḍā\' (Made up later)';
        case '0':
            return '❌ Not prayed';
        default:
            return 'Unknown';
    }
}

// Helper function to convert rawatib numeric value to text status
function getRawatibStatusText(value) {
    switch(value) {
        case '1':
            return '✅ Yes';
        case '0':
            return '❌ No';
        default:
            return 'Unknown';
    }
}

// =============================
// 🔒 Security & Optimization
// =============================

// Disable right-click
document.addEventListener("contextmenu", function(e) {
    e.preventDefault();
});

// Disable inspect shortcuts
document.addEventListener("keydown", function(e) {
    if (e.key === "F12" || 
        (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) ||
        (e.ctrlKey && (e.key === "u" || e.key === "U" || e.key === "s" || e.key === "S"))) {
        e.preventDefault();
    }
});

// Console welcome message
console.log('%c🌙 Tharbiyya - 5 Daily Prayers + Rawatib Tracker 🌙', 'color: #059669; font-size: 16px; font-weight: bold;');
console.log('%cFard Values: Adā\' = 2, Qaḍā\' = 1, No = 0', 'color: #1f2937; font-size: 12px;');
console.log('%cRawatib Values: Yes = 1, No = 0', 'color: #1f2937; font-size: 12px;');
console.log('%cPrayer Order: Subh (Fajr) → Zuhr → Asr → Magrib → Isha', 'color: #1f2937; font-size: 12px;');
console.log('%c⚠️ Students can only submit ONCE per day!', 'color: #dc2626; font-size: 12px; font-weight: bold;');
console.log('%c⚡ Optimized for fast loading with caching', 'color: #059669; font-size: 12px; font-weight: bold;');
