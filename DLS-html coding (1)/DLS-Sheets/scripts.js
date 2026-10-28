import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, setDoc, addDoc, updateDoc, query, where, getDocs, deleteDoc, getDoc, setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Import Supabase service
import { initSupabase, SupabaseDataService } from './supabase-service.js';

setLogLevel('debug');

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

let app;
let db;
let auth;
let userId;
let appState;
let mockMode = false;
let supabaseService;

const PROCESS_MAP = {
    'supply': ['Base File Management', 'Upload Supply Data', 'Bills to Dispatch', 'Supplies in Progress', 'Supply Management'],
    'ugrai': ['Ugrai Base File', 'Total Ugrai', 'Ugrai Issue', 'Ugrai in Progress', 'Ugrai Management'],
    'purchase': ['Purchase Base File', 'Purchase Entry', 'Accounting', 'Purchase Management', 'Purchased'],
    'analysis': ['Supply Analysis', 'Pending Bills', 'Payment Received Analysis', 'Purchase Analysis'],
    'cash-receipt': ['Cash Receipt']
};

// Exact column matching for standardized Excel formats
const SUPPLY_COLUMNS = {
    // Nivea columns
    nivea: {
        billNumber: 'bill number',
        billDate: 'bill date',
        retailerName: 'retailer name',
        netAmount: 'net amount'
    },
    // L'Oreal columns
    loreal: {
        billNumber: 'sale invoice number',
        billDate: 'invoice date',
        retailerName: 'account: account name',
        netAmount: 'total amount',
        status: 'status'
    }
};

const RETAILER_COLUMNS = {
    retailerName: 'retailer name',
    sector: 'sector'
};

// Store earlier manual entries
let existingBillNumbers = ["Cash-2792", "Cash-7289"];

// DOM Elements
let themeToggle, mainProcessesContainer, subProcessesContainer, supplyDashboardContainer, ugraiDashboardContainer, purchaseDashboardContainer, analysisDashboardContainer, cashReceiptDashboardContainer, userIdDisplay, navUserIdDisplay, uploadTypeSelect, fileUploadSection, manualForm, brandSelect, retailerSelect, billNumberInput, billDateInput, netAmountInput, billError, addRetailerBtn, addRetailerModal, addRetailerForm, retailerNameSelect, newRetailerSectorSelect, temporaryBillsTableBody, stagedSelectAll, retailerBaseFileUpload, retailerTableBody, billsCount, allSupplyTableBody, dispatchSelectAll, submitDispatchBtn, activeSuppliesCount, todaysSuppliesTableBody, supplyDoneModal, modalBillSummary, modalBillNumber, supplyDoneForm, deliveryMethodSelect, conditionalFields, photoUploadContainer, receiptNumberContainer, receivedAmountContainer, chequeDateContainer, doneSuppliesCount, billsForApprovalTableBody, approvedBillsCount, suppliesReportTableBody, reportSearchInput, reportDateFilter, exportReportBtn, toastMessage, retailerNameFilter, sectorFilter, totalBillsCard, totalAmountCard, cashAmountCard, creditAmountCard, upiAmountCard, chequeAmountCard, cancelledAmountCard, editedAmountCard, fileUploadInput, baseFileViewBtn;

// Helper: escape HTML to avoid XSS in dynamic tables
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Helper: robust CSV text parser supporting quotes and commas
function parseCSVText(text) {
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let insideQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                currentCell += '"';
                i++; // skip escaped quote
            } else {
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            currentRow.push(currentCell.trim());
            currentCell = '';
        } else if ((char === '\r' || char === '\n') && !insideQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++; // skip CRLF
            }
            currentRow.push(currentCell.trim());
            if (currentRow.some(c => c.length > 0)) {
                rows.push(currentRow);
            }
            currentRow = [];
            currentCell = '';
        } else {
            currentCell += char;
        }
    }
    if (currentCell.length > 0 || currentRow.length > 0) {
        currentRow.push(currentCell.trim());
        if (currentRow.some(c => c.length > 0)) {
            rows.push(currentRow);
        }
    }
    return rows;
}

function findExactColumnIndex(headers, targetColumn) {
    const normalizedHeaders = headers.map(h => String(h || '').toLowerCase().trim());
    const normalizedTarget = targetColumn.toLowerCase().trim();
    return normalizedHeaders.findIndex(header => header === normalizedTarget);
}

function detectSupplyColumns(headers) {
    // Auto-detect file type: L'Oreal has "account gstin" column, Nivea doesn't
    const isLoreal = headers.some(h => h.includes('gstin') || h.includes('account: account name'));

    if (isLoreal) {
        console.log('🔍 Detected L\'Oreal file format');
        return {
            billNumber: findExactColumnIndex(headers, SUPPLY_COLUMNS.loreal.billNumber),
            billDate: findExactColumnIndex(headers, SUPPLY_COLUMNS.loreal.billDate),
            retailerName: findExactColumnIndex(headers, SUPPLY_COLUMNS.loreal.retailerName),
            netAmount: findExactColumnIndex(headers, SUPPLY_COLUMNS.loreal.netAmount),
            status: findExactColumnIndex(headers, SUPPLY_COLUMNS.loreal.status),
            fileType: 'loreal'
        };
    } else {
        console.log('🔍 Detected Nivea file format');
        return {
            billNumber: findExactColumnIndex(headers, SUPPLY_COLUMNS.nivea.billNumber),
            billDate: findExactColumnIndex(headers, SUPPLY_COLUMNS.nivea.billDate),
            retailerName: findExactColumnIndex(headers, SUPPLY_COLUMNS.nivea.retailerName),
            netAmount: findExactColumnIndex(headers, SUPPLY_COLUMNS.nivea.netAmount),
            status: -1, // Nivea doesn't have status column
            fileType: 'nivea'
        };
    }
}

function detectRetailerColumns(headers) {
    return {
        retailerName: findExactColumnIndex(headers, RETAILER_COLUMNS.retailerName),
        sector: findExactColumnIndex(headers, RETAILER_COLUMNS.sector)
    };
}

function initDOMReferences() {
    themeToggle = document.getElementById('theme-toggle');
    mainProcessesContainer = document.getElementById('main-processes');
    subProcessesContainer = document.getElementById('sub-processes');
    supplyDashboardContainer = document.getElementById('supply-dashboard-container');
    ugraiDashboardContainer = document.getElementById('ugrai-dashboard-container');
    purchaseDashboardContainer = document.getElementById('purchase-dashboard-container');
    analysisDashboardContainer = document.getElementById('analysis-dashboard-container');
    cashReceiptDashboardContainer = document.getElementById('cash-receipt-dashboard-container');
    userIdDisplay = document.getElementById('user-id-display');
    navUserIdDisplay = document.getElementById('nav-user-id');
    uploadTypeSelect = document.getElementById('bill-upload-type');
    fileUploadSection = document.getElementById('file-upload-section');
    manualForm = document.getElementById('manual-bill-form');
    brandSelect = document.getElementById('brand');
    retailerSelect = document.getElementById('retailer');
    billNumberInput = document.getElementById('billNumber');
    billDateInput = document.getElementById('billDate');
    netAmountInput = document.getElementById('netAmount');
    billError = document.getElementById('billError');
    addRetailerBtn = document.getElementById('add-retailer-btn');
    addRetailerModal = document.getElementById('add-retailer-modal');
    addRetailerForm = document.getElementById('add-retailer-form');
    retailerNameSelect = document.getElementById('retailer-name');
    newRetailerSectorSelect = document.getElementById('new-retailer-sector');
    temporaryBillsTableBody = document.getElementById('temporary-bills-table');
    stagedSelectAll = document.getElementById('staged-select-all');
    retailerBaseFileUpload = document.getElementById('retailer-base-file-upload');
    retailerTableBody = document.getElementById('retailer-table');
    billsCount = document.getElementById('bills-count');
    allSupplyTableBody = document.getElementById('all-supply-table');
    dispatchSelectAll = document.getElementById('dispatch-select-all');
    submitDispatchBtn = document.getElementById('submit-dispatch-btn');
    activeSuppliesCount = document.getElementById('active-supplies-count');
    todaysSuppliesTableBody = document.getElementById('todays-supplies-table');
    supplyDoneModal = document.getElementById('supply-done-modal');
    modalBillSummary = document.getElementById('modal-bill-summary');
    modalBillNumber = document.getElementById('modal-bill-id');
    supplyDoneForm = document.getElementById('supply-done-form');
    deliveryMethodSelect = document.getElementById('delivery-method');
    conditionalFields = document.getElementById('conditional-fields');
    photoUploadContainer = document.getElementById('photo-upload-container');
    receiptNumberContainer = document.getElementById('receipt-number-container');
    receivedAmountContainer = document.getElementById('received-amount-container');
    chequeDateContainer = document.getElementById('cheque-date-container');
    doneSuppliesCount = document.getElementById('done-supplies-count');
    billsForApprovalTableBody = document.getElementById('bills-for-approval-table');
    approvedBillsCount = document.getElementById('approved-bills-count');
    suppliesReportTableBody = document.getElementById('supplies-report-table');
    reportSearchInput = document.getElementById('report-search');
    reportDateFilter = document.getElementById('report-date-filter');
    exportReportBtn = document.getElementById('export-report-btn');
    toastMessage = document.getElementById('toast-message');
    retailerNameFilter = document.getElementById('retailer-name-filter');
    sectorFilter = document.getElementById('sector-filter');
    totalBillsCard = document.getElementById('total-bills-card');
    totalAmountCard = document.getElementById('total-amount-card');
    cashAmountCard = document.getElementById('cash-amount-card');
    creditAmountCard = document.getElementById('credit-amount-card');
    upiAmountCard = document.getElementById('upi-amount-card');
    chequeAmountCard = document.getElementById('cheque-amount-card');
    cancelledAmountCard = document.getElementById('cancelled-amount-card');
    editedAmountCard = document.getElementById('edited-amount-card');
    fileUploadInput = document.getElementById('file-upload-input');
}

// Helper function to find duplicates in an array
function findDuplicatesInArray(array, key) {
    const counts = {};
    const duplicates = [];

    // Count occurrences
    array.forEach(item => {
        const value = item[key];
        counts[value] = (counts[value] || 0) + 1;
    });

    // Find duplicates
    Object.entries(counts).forEach(([value, count]) => {
        if (count > 1) {
            duplicates.push({ value, count });
        }
    });

    return duplicates;
}

function initEventListeners() {
    if (themeToggle) themeToggle.addEventListener('click', toggleTheme);

    // Hamburger menu functionality
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const mobileNav = document.getElementById('mobile-nav');
    const navPanel = document.getElementById('nav-panel');
    const closeNavBtn = document.getElementById('close-nav-btn');
    const navBackdrop = document.getElementById('nav-backdrop');
    const navAdminBtn = document.getElementById('nav-admin-btn');
    const navLogoutBtn = document.getElementById('nav-logout-btn');
    const navThemeToggle = document.getElementById('nav-theme-toggle');

    // Open mobile navigation
    const openMobileNav = () => {
        if (mobileNav && navPanel) {
            // Show backdrop with fade-in
            mobileNav.classList.remove('opacity-0', 'pointer-events-none');
            mobileNav.classList.add('opacity-100');
            document.body.style.overflow = 'hidden';

            // Slide in panel after a tiny delay for smooth animation
            setTimeout(() => {
                navPanel.classList.remove('-translate-x-full');
                navPanel.classList.add('translate-x-0');
            }, 10);
        }
    };

    // Close mobile navigation
    const closeMobileNav = () => {
        if (mobileNav && navPanel) {
            // Slide out panel first
            navPanel.classList.remove('translate-x-0');
            navPanel.classList.add('-translate-x-full');

            // Fade out backdrop after panel animation
            setTimeout(() => {
                mobileNav.classList.remove('opacity-100');
                mobileNav.classList.add('opacity-0', 'pointer-events-none');
                document.body.style.overflow = '';
            }, 300);
        }
    };

    // Event listeners for hamburger menu
    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', openMobileNav);
    }
    if (closeNavBtn) {
        closeNavBtn.addEventListener('click', closeMobileNav);
    }
    if (navBackdrop) {
        navBackdrop.addEventListener('click', closeMobileNav);
    }

    // Navigation admin button
    if (navAdminBtn) {
        navAdminBtn.addEventListener('click', () => {
            window.location.href = 'admin.html';
        });
    }

    // Navigation theme toggle
    if (navThemeToggle) {
        navThemeToggle.addEventListener('click', () => {
            toggleTheme();
            updateNavToggleBallPosition(localStorage.getItem('theme') || 'light');
        });
    }

    // Navigation logout button
    if (navLogoutBtn) {
        navLogoutBtn.addEventListener('click', async () => {
            closeMobileNav(); // Close menu first
            const result = await Swal.fire({
                title: 'Logout?',
                text: 'Are you sure you want to logout?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#dc2626',
                cancelButtonColor: '#6b7280',
                confirmButtonText: 'Yes, logout'
            });

            if (result.isConfirmed) {
                await handleLogout();
            }
        });
    }

    // Logout button event listener (existing desktop logout)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            const result = await Swal.fire({
                title: 'Logout?',
                text: 'Are you sure you want to logout?',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#dc2626',
                cancelButtonColor: '#6b7280',
                confirmButtonText: 'Yes, logout'
            });

            if (result.isConfirmed) {
                await handleLogout();
            }
        });
    }

    if (mainProcessesContainer) {
        mainProcessesContainer.addEventListener('click', async (e) => {
            const button = e.target.closest('button');
            if (button) {
                const processName = button.dataset.process;
                renderMainContent(processName);
                renderSubProcesses(processName);

                // Load UGRAI data when UGRAI process is selected
                if (processName === 'ugrai' && appState) {
                    console.log('🔄 Loading UGRAI data for process switch...');
                    await appState.loadUgraiData();
                    // Initialize UGRAI dashboard after data is loaded
                    initializeUgraiDashboard();
                    // Refresh the UI after data is loaded
                    setTimeout(() => {
                        renderDashboard();
                    }, 100);
                }

                // Initialize Cash Receipt dashboard when selected
                if (processName === 'cash-receipt') {
                    console.log('🏦 Initializing Cash Receipt dashboard...');
                    await initializeCashReceiptDashboard();

                    // Ensure section is visible after initialization
                    const section = document.getElementById('cash-receipt-section');
                    const content = document.getElementById('cash-receipt-content');
                    if (section) {
                        section.style.display = 'block';
                        section.classList.remove('hidden');
                        console.log('✅ Cash receipt section visibility ensured');
                    }
                    if (content) {
                        content.style.opacity = '1';
                        content.style.pointerEvents = 'auto';
                        console.log('✅ Cash receipt content opacity ensured');
                    }

                    // Load initial data with try-catch
                    try {
                        console.log('📥 About to call loadCashPayments()...');
                        await loadCashPayments();
                        console.log('✅ loadCashPayments() completed successfully');
                    } catch (error) {
                        console.error('❌ Error calling loadCashPayments():', error);
                        console.error('Error stack:', error.stack);
                    }
                }

                // Force show first tab content for purchase
                if (processName === 'purchase') {
                    setTimeout(() => {
                        const firstTab = document.querySelector('[data-tab-content="purchase-base-file"]');
                        if (firstTab) {
                            firstTab.style.display = 'block';
                        }
                    }, 100);
                }
            }
        });
    }
    if (subProcessesContainer) {
        subProcessesContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.sub-heading');
            if (button) {
                const tabId = button.dataset.tabId;
                console.log('Clicking tab with ID:', tabId); // Add this

                const allContentSections = document.querySelectorAll('[data-tab-content]');
                console.log(`🔄 Hiding ${allContentSections.length} content sections`);
                allContentSections.forEach(section => {
                    section.style.display = 'none';
                });

                const selectedContent = document.querySelector(`[data-tab-content="${tabId}"]`);
                console.log('🔍 Found content section:', selectedContent);

                if (selectedContent) {
                    selectedContent.style.display = 'block';
                    selectedContent.classList.remove('hidden'); // Also remove Tailwind hidden class
                    console.log(`✅ Set ${tabId} section to display: block`);
                    console.log('Current section display style:', selectedContent.style.display);
                    console.log('Section classes:', selectedContent.className);
                    console.log('Computed display:', window.getComputedStyle(selectedContent).display);
                } else {
                    console.error(`❌ No content section found for tab: ${tabId}`);
                }

                document.querySelectorAll('.sub-heading').forEach(btn => {
                    btn.classList.remove('active');
                });
                button.classList.add('active');
            }
        });
    }

    if (uploadTypeSelect) {
        uploadTypeSelect.addEventListener('change', (e) => {
            if (e.target.value === 'manual') {
                fileUploadSection.classList.add('hidden');
                document.getElementById('manual-bill-form').classList.remove('hidden');
                document.getElementById('edited-bills-form').classList.add('hidden');
                // Auto-generate unique bill number when switching to manual entry
                if (billNumberInput) {
                    generateUniqueBillNumber();
                    billNumberInput.style.borderColor = "#ccc";
                }
                // Hide any error messages
                if (billError) {
                    billError.style.display = "none";
                }
            } else if (e.target.value === 'edited-bills') {
                fileUploadSection.classList.add('hidden');
                document.getElementById('manual-bill-form').classList.add('hidden');
                document.getElementById('edited-bills-form').classList.remove('hidden');
                loadEditedBills();
            } else {
                fileUploadSection.classList.remove('hidden');
                document.getElementById('manual-bill-form').classList.add('hidden');
                document.getElementById('edited-bills-form').classList.add('hidden');
            }
        });
    }

    // Add to Staging button for manual entry
    document.addEventListener('click', async (e) => {
        if (e.target.id === 'add-to-staging-btn') {
            e.preventDefault();
            const billNumber = billNumberInput.value.trim();
            const retailerName = retailerSelect.value;
            const retailer = appState.data.retailers.find(r => r.name === retailerName);
            const brand = brandSelect.value;
            const billDate = billDateInput.value;
            const netAmount = netAmountInput.value;

            // Validation
            if (!brand || !retailerName || !billNumber || !billDate || !netAmount) {
                showToast('Please fill in all fields');
                return;
            }

            // Check for duplicate bill number
            const existingBills = await appState.checkExistingBills([billNumber]);
            if (existingBills.length > 0) {
                // Show error styling
                billNumberInput.style.borderColor = "red";
                if (billError) {
                    billError.style.display = "block";
                    billError.textContent = "This bill number already exists!";
                }
                showToast('❌ Bill number already exists. Please use a different bill number.', 'error');
                return;
            } else {
                // Clear error styling if no duplicates
                billNumberInput.style.borderColor = "#ccc";
                if (billError) {
                    billError.style.display = "none";
                }
            }

            const newBill = {
                uniqueId: `${billNumber}-${billDate}`,
                brand: brand,
                billNumber: billNumber,
                billDate: billDate,
                retailerName: retailer ? retailer.name : retailerName,
                sector: retailer ? retailer.sector : 'N/A',
                netAmount: netAmount,
                status: "Pending"
            };

            appState.addTemporaryBill(newBill);

            // Clear form and generate new unique bill number
            brandSelect.value = '';
            retailerSelect.value = '';
            generateUniqueBillNumber();
            billDateInput.value = '';
            netAmountInput.value = '';

            // Hide error message
            if (billError) {
                billError.style.display = "none";
            }
            billNumberInput.style.borderColor = "#ccc";
        }
    });

    if (addRetailerBtn) {
        addRetailerBtn.addEventListener('click', () => {
            showModal('add-retailer-modal');
            const nameInput = document.getElementById('new-retailer-name');
            if (nameInput) setTimeout(() => nameInput.focus(), 100);
        });
    }

    if (newRetailerSectorSelect) {
        newRetailerSectorSelect.addEventListener('change', (e) => {
            const existingNewSectorInput = document.getElementById('new-sector-input');
            if (e.target.value === '--- New Sector ---') {
                if (!existingNewSectorInput) {
                    const newInput = document.createElement('input');
                    newInput.type = 'text';
                    newInput.id = 'new-sector-input';
                    newInput.placeholder = 'Enter new sector...';
                    newInput.className = 'w-full bg-gray-100 rounded-lg p-2.5 border border-gray-300 mt-1 focus:outline-none focus:border-red-600';
                    newInput.required = true;
                    newRetailerSectorSelect.parentNode.appendChild(newInput);
                }
                newRetailerSectorSelect.style.display = 'none';
            } else if (existingNewSectorInput) {
                existingNewSectorInput.parentNode.removeChild(existingNewSectorInput);
                newRetailerSectorSelect.style.display = 'block';
            }
        });
    }

    if (addRetailerForm) {
        addRetailerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('new-retailer-name');
            const sectorInput = document.getElementById('new-sector-input') || document.getElementById('new-retailer-sector');
            const newRetailerName = nameInput ? nameInput.value.trim() : '';
            const newRetailerSector = sectorInput ? sectorInput.value.trim() : '';
            if (!newRetailerName || !newRetailerSector) {
                showToast('Please enter both retailer name and sector.', 'error');
                return;
            }
            const submitBtn = addRetailerForm.querySelector('button[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Adding...';
            }
            try {
                const success = await appState.addRetailer(String(newRetailerName), String(newRetailerSector));
                if (success !== false) {
                    closeModal('add-retailer-modal');
                    addRetailerForm.reset();
                    const existingNewSectorInput = document.getElementById('new-sector-input');
                    if (existingNewSectorInput) existingNewSectorInput.remove();
                }
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Add Retailer';
                }
            }
        });
    }

    // Inline Quick-Add Retailer (Base File Management)
    const inlineAddBtn = document.getElementById('inline-add-retailer-btn');
    const inlineNameInput = document.getElementById('inline-new-retailer-name');
    const inlineSectorInput = document.getElementById('inline-new-retailer-sector');

    async function handleInlineAddRetailer() {
        const nameInput = document.getElementById('inline-new-retailer-name');
        const sectorInput = document.getElementById('inline-new-retailer-sector');
        const addBtn = document.getElementById('inline-add-retailer-btn');

        if (!nameInput || !sectorInput) return;
        const name = nameInput.value.trim();
        const sector = sectorInput.value.trim();

        if (!name) {
            showToast('Please enter a retailer name', 'error');
            nameInput.focus();
            return;
        }
        if (!sector) {
            showToast('Please enter or select a sector', 'error');
            sectorInput.focus();
            return;
        }

        if (addBtn) {
            addBtn.disabled = true;
            addBtn.innerHTML = `<span>Adding...</span>`;
        }

        try {
            const success = await appState.addRetailer(String(name), String(sector));
            if (success !== false) {
                nameInput.value = '';
                sectorInput.value = '';
                nameInput.focus();
            }
        } finally {
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.innerHTML = `
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
                    <span>Add Retailer</span>
                `;
            }
        }
    }

    if (inlineAddBtn) {
        inlineAddBtn.addEventListener('click', handleInlineAddRetailer);
    }

    if (inlineNameInput) {
        inlineNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const sectorInput = document.getElementById('inline-new-retailer-sector');
                if (!sectorInput || !sectorInput.value.trim()) {
                    if (sectorInput) sectorInput.focus();
                } else {
                    handleInlineAddRetailer();
                }
            }
        });
    }

    if (inlineSectorInput) {
        inlineSectorInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleInlineAddRetailer();
            }
        });
    }

    if (billNumberInput) {
        billNumberInput.addEventListener("blur", function () {
            let billNumber = this.value.trim();
            let errorMsg = billError;

            // Check against existing bills and currently staged bills
            const allExistingBills = [
                ...existingBillNumbers,
                ...appState.data.temporaryBills.map(bill => bill.billNumber)
            ];

            if (allExistingBills.includes(billNumber)) {
                if (errorMsg) {
                    errorMsg.style.display = "block";
                }
                this.style.borderColor = "red";
            } else {
                if (errorMsg) {
                    errorMsg.style.display = "none";
                }
                this.style.borderColor = "#ccc";
            }
        });
    }

    // SUPPLY DATA FILE UPLOAD
    if (fileUploadInput) {
        fileUploadInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const validExtensions = ['xlsx', 'xls'];
            const fileExtension = file.name.split('.').pop().toLowerCase();
            if (!validExtensions.includes(fileExtension)) {
                showToast('Please upload an Excel file (.xlsx or .xls)');
                return;
            }

            console.log('Supply file selected:', file.name);

            if (typeof XLSX === 'undefined') {
                showToast('Excel reader library not loaded. Please refresh the page.');
                return;
            }

            try {
                // Use XLSX library to support both .xls and .xlsx formats
                const data = await file.arrayBuffer();
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });

                console.log('Supply data read successfully. Rows:', rows.length);

                if (!rows || rows.length < 2) {
                    showToast('Excel file is empty or contains only headers.');
                    return;
                }

                const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
                console.log('Supply headers:', headers);

                const columnIndices = detectSupplyColumns(headers);
                console.log('Supply column indices:', columnIndices);
                console.log('File type detected:', columnIndices.fileType);

                // Show file type detection
                const fileTypeName = columnIndices.fileType === 'loreal' ? 'L\'Oreal' : 'Nivea';
                showToast(`📊 Detected ${fileTypeName} file format`, 'info', 2000);

                const missingColumns = [];
                if (columnIndices.billNumber === -1) missingColumns.push('Bill Number');
                if (columnIndices.billDate === -1) missingColumns.push('Bill Date');
                if (columnIndices.retailerName === -1) missingColumns.push('Retailer Name');
                if (columnIndices.netAmount === -1) missingColumns.push('Net Amount');

                if (missingColumns.length > 0) {
                    showToast(`Missing columns: ${missingColumns.join(', ')}. Found: ${headers.join(', ')}`);
                    return;
                }

                const fileType = columnIndices.fileType;
                const billsToAdd = [];
                const missingRetailers = new Map(); // Track retailers that need to be created
                let skippedCancelledCount = 0;

                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    if (row.length > 0 && row.some(cell => cell !== null && cell !== '')) {

                        const billNumber = String(row[columnIndices.billNumber] || '').trim();
                        const billDate = row[columnIndices.billDate];
                        const retailerName = String(row[columnIndices.retailerName] || '').trim();
                        const netAmount = parseFloat(row[columnIndices.netAmount]) || 0;

                        // Check status for L'Oreal files and skip if cancelled
                        if (fileType === 'loreal' && columnIndices.status !== -1) {
                            const status = String(row[columnIndices.status] || '').trim().toLowerCase();
                            if (status === 'invoice cancelled') {
                                console.log(`⏭️ Skipping cancelled invoice: ${billNumber}`);
                                skippedCancelledCount++;
                                continue;
                            }
                        }

                        if (!billNumber || !retailerName || !netAmount) {
                            continue;
                        }

                        // Determine brand based on file type
                        let brand = '';
                        if (fileType === 'loreal') {
                            brand = 'Loreal';
                        } else if (fileType === 'nivea') {
                            // For Nivea files, detect brand from bill number prefix
                            if (billNumber.toLowerCase().startsWith('l')) {
                                brand = 'Loreal';
                            } else if (billNumber.toLowerCase().startsWith('n')) {
                                brand = 'Nivea';
                            } else {
                                brand = 'Nivea'; // Default to Nivea for this file type
                            }
                        } else {
                            brand = 'N/A';
                        }

                        const retailer = appState.data.retailers.find(r =>
                            String(r.name).toLowerCase().trim() === String(retailerName).toLowerCase().trim()
                        );

                        let sector = 'N/A';
                        if (retailer) {
                            // Use existing retailer's sector
                            sector = retailer.sector;
                        } else {
                            // Retailer doesn't exist GLOBALLY - mark it for creation
                            // Only add to missingRetailers if truly new
                            if (!missingRetailers.has(retailerName.toLowerCase().trim())) {
                                missingRetailers.set(retailerName.toLowerCase().trim(), {
                                    name: retailerName,
                                    sector: 'N/A'  // Changed from 'Unassigned' to 'N/A' for clarity
                                });
                            }
                            sector = 'N/A'; // Temporarily set to N/A until retailer is created
                        }

                        // Convert Excel date to proper date format
                        let formattedBillDate;
                        if (billDate) {
                            // Check if it's an Excel serial number (numeric)
                            if (typeof billDate === 'number') {
                                // Convert Excel serial date to JavaScript Date
                                const excelEpoch = new Date(1899, 11, 30); // Excel epoch: Dec 30, 1899
                                const msPerDay = 24 * 60 * 60 * 1000;
                                const jsDate = new Date(excelEpoch.getTime() + billDate * msPerDay);
                                formattedBillDate = jsDate.toISOString().split('T')[0];
                            } else if (typeof billDate === 'string') {
                                // Parse string date (DD/MM/YYYY format common in Excel)
                                if (billDate.includes('/')) {
                                    const parts = billDate.split('/');
                                    if (parts.length === 3) {
                                        // Assume DD/MM/YYYY format
                                        const day = parts[0].padStart(2, '0');
                                        const month = parts[1].padStart(2, '0');
                                        const year = parts[2];
                                        formattedBillDate = `${year}-${month}-${day}`;
                                    } else {
                                        formattedBillDate = new Date(billDate).toISOString().split('T')[0];
                                    }
                                } else {
                                    formattedBillDate = new Date(billDate).toISOString().split('T')[0];
                                }
                            } else {
                                formattedBillDate = new Date(billDate).toISOString().split('T')[0];
                            }
                        } else {
                            formattedBillDate = new Date().toISOString().split('T')[0];
                        }

                        const newBill = {
                            brand: brand,
                            billNumber: billNumber,
                            billDate: formattedBillDate,
                            retailerName: retailerName,
                            sector: String(sector),
                            netAmount: netAmount,
                            status: "Pending"
                        };
                        newBill.uniqueId = `${newBill.billNumber}-${newBill.billDate}`;
                        billsToAdd.push(newBill);
                    }
                }

                if (billsToAdd.length === 0) {
                    if (skippedCancelledCount > 0) {
                        showToast(`No valid bills to process. ${skippedCancelledCount} cancelled invoice(s) were skipped.`, 'info');
                    } else {
                        showToast('No valid data rows found in the Excel file.');
                    }
                    return;
                }

                // Show info about skipped cancelled invoices
                if (skippedCancelledCount > 0) {
                    showToast(`ℹ️ Skipped ${skippedCancelledCount} cancelled invoice(s). Processing ${billsToAdd.length} valid bill(s).`, 'info', 4000);
                }

                // Auto-create missing retailers before processing bills
                if (missingRetailers.size > 0) {
                    console.log(`📝 Auto-creating ${missingRetailers.size} missing retailers...`);
                    const retailersToCreate = Array.from(missingRetailers.values());

                    try {
                        await appState.addRetailers(retailersToCreate);
                        showToast(`✅ Auto-created ${missingRetailers.size} new retailer(s) with sector "N/A" - please assign sectors`, 'info', 5000);
                    } catch (error) {
                        console.error('Error auto-creating retailers:', error);
                        showToast('⚠️ Some retailers could not be created automatically', 'warning');
                    }
                }

                // Check for duplicates within the uploaded file
                console.log('Checking for duplicates in file...', billsToAdd.map(b => b.billNumber));
                const duplicatesInFile = findDuplicatesInArray(billsToAdd, 'billNumber');
                console.log('Duplicates found in file:', duplicatesInFile);

                if (duplicatesInFile.length > 0) {
                    const totalDuplicateCount = duplicatesInFile.reduce((sum, dup) => sum + dup.count, 0);
                    console.log('Showing duplicate error toast. Found', duplicatesInFile.length, 'unique duplicates');
                    showToast(`🚫 Found ${duplicatesInFile.length} duplicate bill number(s) in your file with ${totalDuplicateCount} total duplicate entries. Please remove duplicates and try again.`, 'error', 10000);
                    e.target.value = ''; // Clear the file input
                    return;
                }

                // Check for duplicates against existing bills in database
                console.log('Checking for existing bills in database...');
                const billNumbers = billsToAdd.map(b => b.billNumber);
                const existingBills = await appState.checkExistingBills(billNumbers);
                console.log('Existing bills found in database:', existingBills);

                if (existingBills.length > 0) {
                    console.log('Showing existing bills error toast. Count:', existingBills.length);
                    showToast(`🚫 ${existingBills.length} bill number(s) already exist in the database. Please check your data and try again.`, 'error', 10000);
                    e.target.value = ''; // Clear the file input
                    return;
                }

                // Add bills if no duplicates found
                console.log(`Processing ${billsToAdd.length} bills for upload...`);
                let successCount = 0;
                let errorCount = 0;

                for (const bill of billsToAdd) {
                    try {
                        await appState.addTemporaryBill(bill);
                        successCount++;
                    } catch (error) {
                        errorCount++;
                        console.error('Error adding bill:', bill.billNumber, error);
                    }
                }

                if (errorCount > 0) {
                    showToast(`⚠️ Upload completed with issues: ${successCount} bills staged successfully, ${errorCount} failed. Check console for details.`, 'warning', 6000);
                } else {
                    showToast(`✅ Upload successful! ${successCount} bill(s) have been staged and are ready for dispatch.`, 'success', 4000);
                }
                e.target.value = '';

            } catch (error) {
                console.error("Supply file error:", error);
                showToast(`Error: ${error.message || 'Failed to read the Excel file'}`);
            }
        });
    }

    // RETAILER DATA FILE UPLOAD (EXCEL OR CSV)
    console.log('🔧 Setting up retailer file upload listener. Element found:', !!retailerBaseFileUpload);
    if (retailerBaseFileUpload) {
        console.log('✅ Retailer file upload element found, attaching listener');
        retailerBaseFileUpload.addEventListener('change', async (e) => {
            console.log('🚀 Retailer file upload triggered!');
            const file = e.target.files[0];
            console.log('📁 Selected file:', file ? file.name : 'No file selected');

            if (!file) {
                console.log('❌ No file selected, exiting');
                return;
            }

            const validExtensions = ['xlsx', 'xls', 'csv'];
            const fileExtension = file.name.split('.').pop().toLowerCase();
            console.log('📄 File extension:', fileExtension);

            if (!validExtensions.includes(fileExtension)) {
                console.log('❌ Invalid file extension');
                showToast('Please upload an Excel or CSV file (.xlsx, .xls, .csv)', 'error');
                return;
            }

            console.log('✅ Valid file selected:', file.name);

            try {
                console.log('Reading retailer file:', file.name);
                let retailerRows = [];

                if (fileExtension === 'csv') {
                    if (typeof XLSX !== 'undefined') {
                        try {
                            const data = await file.arrayBuffer();
                            const workbook = XLSX.read(data, { type: 'array' });
                            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                            retailerRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
                        } catch (err) {
                            console.warn('XLSX CSV parse fallback to text:', err);
                        }
                    }
                    if (!retailerRows || retailerRows.length < 2) {
                        const text = await file.text();
                        retailerRows = parseCSVText(text);
                    }
                } else {
                    if (typeof XLSX === 'undefined') {
                        showToast('Excel reader library not loaded. Please refresh the page.', 'error');
                        return;
                    }
                    const data = await file.arrayBuffer();
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    retailerRows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, defval: '' });
                }

                console.log('Retailer data read successfully. Rows:', retailerRows.length);

                if (!retailerRows || retailerRows.length < 2) {
                    showToast('File is empty or contains only headers.', 'warning');
                    return;
                }

                const headers = retailerRows[0].map(h => String(h || '').toLowerCase().trim());
                console.log('Retailer headers:', headers);

                const columnIndices = detectRetailerColumns(headers);
                console.log('Retailer column indices:', columnIndices);

                const missingColumns = [];
                if (columnIndices.retailerName === -1) missingColumns.push('Retailer Name');
                if (columnIndices.sector === -1) missingColumns.push('Sector');

                if (missingColumns.length > 0) {
                    showToast(`Missing columns: ${missingColumns.join(', ')}. Found: ${headers.join(', ')}`, 'error');
                    return;
                }

                const newRetailers = [];
                for (let i = 1; i < retailerRows.length; i++) {
                    const row = retailerRows[i];
                    const retailerName = String(row[columnIndices.retailerName] || '').trim();
                    const sector = String(row[columnIndices.sector] || '').trim();

                    if (retailerName && sector) {
                        newRetailers.push({ name: retailerName, sector: sector });
                    }
                }

                if (newRetailers.length === 0) {
                    showToast('No valid retailer data found in file.', 'warning');
                    return;
                }

                // Remove duplicates within the uploaded file (keep first occurrence)
                const uniqueRetailers = [];
                const seenNames = new Set();
                let duplicateCount = 0;

                newRetailers.forEach(retailer => {
                    const nameLower = retailer.name.toLowerCase().trim();
                    if (!seenNames.has(nameLower)) {
                        seenNames.add(nameLower);
                        uniqueRetailers.push(retailer);
                    } else {
                        duplicateCount++;
                    }
                });

                console.log(`📊 Duplicate removal: ${newRetailers.length} total → ${uniqueRetailers.length} unique (${duplicateCount} duplicates removed)`);

                if (duplicateCount > 0) {
                    showToast(`ℹ️ Removed ${duplicateCount} duplicate entries from file. Processing ${uniqueRetailers.length} unique retailers.`, 'info', 4000);
                }

                // Use the deduplicated array
                const finalRetailers = uniqueRetailers;

                // Check for duplicates against existing retailers
                console.log('🔍 Checking for duplicates against database. AppState available:', !!appState);
                if (!appState) {
                    console.error('❌ AppState not available!');
                    showToast('Application not properly initialized. Please refresh the page.', 'error');
                    return;
                }

                // Refresh retailer data to ensure we have the latest information
                console.log('🔄 Refreshing retailer data before duplicate check...');
                await appState.loadRetailers();

                const existingRetailers = await appState.checkExistingRetailers(finalRetailers.map(r => r.name));
                let retailersToAdd = finalRetailers;

                console.log('📊 Existing retailers found:', existingRetailers.length, existingRetailers);

                if (existingRetailers.length > 0) {
                    // Filter out retailers that already exist in database
                    retailersToAdd = finalRetailers.filter(retailer =>
                        !existingRetailers.some(existingName =>
                            existingName.toLowerCase().trim() === retailer.name.toLowerCase().trim()
                        )
                    );

                    console.log(`🗃️ Database duplicate filtering: ${finalRetailers.length} → ${retailersToAdd.length} (${existingRetailers.length} already exist)`);
                    console.log('🚫 Retailers already in database:', existingRetailers);
                    console.log('✅ New retailers to add:', retailersToAdd.map(r => r.name));

                    if (retailersToAdd.length === 0) {
                        showToast(`ℹ️ All ${finalRetailers.length} retailers in the file already exist in the database.`, 'info', 5000);
                        e.target.value = ''; // Clear the file input
                        // Make sure table is visible to see existing retailers
                        const tableContainer = document.getElementById('retailer-data-table-container');
                        if (tableContainer) tableContainer.classList.remove('hidden');
                        renderDashboard();
                        return;
                    }

                    showToast(`ℹ️ Found ${existingRetailers.length} retailers that already exist. Adding ${retailersToAdd.length} new retailers.`, 'info', 4000);
                } else {
                    console.log('✅ No existing retailers found, adding all retailers');
                    retailersToAdd = finalRetailers;
                }

                console.log('💾 Saving retailers to database...');
                const result = await appState.addRetailers(retailersToAdd);
                const addedCount = result.addedCount || 0;
                const skippedCount = retailersToAdd.length - addedCount;

                console.log(`✅ ${addedCount} new retailers saved, ${skippedCount} duplicates skipped`);

                // Reload the retailers data to reflect changes
                console.log('🔄 Reloading retailers data...');
                await appState.loadRetailers();
                console.log('✅ Retailers data reloaded');

                if (addedCount > 0 && skippedCount > 0) {
                    showToast(`✅ ${addedCount} new retailers added, ${skippedCount} duplicates skipped`, 'success', 5000);
                } else if (addedCount > 0) {
                    showToast(`✅ ${addedCount} new retailers added successfully!`, 'success');
                } else {
                    showToast(`ℹ️ No new retailers added - all ${skippedCount} retailers already exist`, 'info', 4000);
                }

                // Clear the file input to prevent re-uploads
                e.target.value = '';
                console.log('🧹 File input cleared');

                // Auto-show table and reset page to 1
                const tableContainer = document.getElementById('retailer-data-table-container');
                if (tableContainer) {
                    tableContainer.classList.remove('hidden');
                }
                window.retailerCurrentPage = 1;
                renderDashboard();

            } catch (error) {
                console.error('Retailer file error:', error);
                showToast(`Error: ${error.message || 'Failed to read the retailer file'}`, 'error');
            }
        });
    }

    // Select All functionality for staged bills
    document.addEventListener('change', (e) => {
        if (e.target.id === 'staged-select-all') {
            const checkboxes = document.querySelectorAll('.staged-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = e.target.checked;
            });
        } else if (e.target.id === 'dispatch-select-all') {
            const checkboxes = document.querySelectorAll('.dispatch-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = e.target.checked;
            });
        } else if (e.target.id === 'approval-select-all') {
            const checkboxes = document.querySelectorAll('.approval-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = e.target.checked;
            });
        }
    });

    if (document.getElementById('staged-bills-submit-selected-btn')) {
        document.getElementById('staged-bills-submit-selected-btn').addEventListener('click', () => {
            const selectedBillIds = Array.from(document.querySelectorAll('.staged-checkbox:checked'))
                .map(checkbox => checkbox.dataset.billId);
            if (selectedBillIds.length > 0) {
                appState.moveSelectedBillsToDispatch(selectedBillIds);
            } else {
                showToast('Please select at least one bill to submit.');
            }
        });
    }

    if (retailerNameFilter) {
        retailerNameFilter.addEventListener('input', () => {
            window.retailerCurrentPage = 1;
            renderDashboard();
        });
    }
    if (sectorFilter) {
        sectorFilter.addEventListener('input', () => {
            window.retailerCurrentPage = 1;
            renderDashboard();
        });
    }

    const clearRetailerFiltersBtn = document.getElementById('clear-retailer-filters-btn');
    if (clearRetailerFiltersBtn) {
        clearRetailerFiltersBtn.addEventListener('click', () => {
            if (retailerNameFilter) retailerNameFilter.value = '';
            if (sectorFilter) sectorFilter.value = '';
            window.retailerCurrentPage = 1;
            renderDashboard();
        });
    }

    const retailerPrevBtn = document.getElementById('retailer-prev-page-btn');
    if (retailerPrevBtn) {
        retailerPrevBtn.addEventListener('click', () => {
            if ((window.retailerCurrentPage || 1) > 1) {
                window.retailerCurrentPage--;
                renderDashboard();
            }
        });
    }

    const retailerNextBtn = document.getElementById('retailer-next-page-btn');
    if (retailerNextBtn) {
        retailerNextBtn.addEventListener('click', () => {
            window.retailerCurrentPage = (window.retailerCurrentPage || 1) + 1;
            renderDashboard();
        });
    }

    const retailerPageSizeSelect = document.getElementById('retailer-page-size');
    if (retailerPageSizeSelect) {
        retailerPageSizeSelect.addEventListener('change', (e) => {
            window.retailerPageSize = e.target.value;
            window.retailerCurrentPage = 1;
            renderDashboard();
        });
    }

    // Retailer table: Multi-select header checkbox
    const retailersSelectAll = document.getElementById('retailers-select-all');
    if (retailersSelectAll) {
        retailersSelectAll.addEventListener('change', (e) => {
            window.selectedRetailers = window.selectedRetailers || new Set();
            const checkboxes = document.querySelectorAll('.retailer-row-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = e.target.checked;
                const name = cb.dataset.name;
                if (name) {
                    if (e.target.checked) window.selectedRetailers.add(name);
                    else window.selectedRetailers.delete(name);
                }
            });
            renderDashboard();
        });
    }

    // Retailer table: Row checkbox change delegation
    document.addEventListener('change', (e) => {
        if (e.target && e.target.classList.contains('retailer-row-checkbox')) {
            window.selectedRetailers = window.selectedRetailers || new Set();
            const name = e.target.dataset.name;
            if (name) {
                if (e.target.checked) window.selectedRetailers.add(name);
                else window.selectedRetailers.delete(name);
            }
            renderDashboard();
        }
    });

    // Clear selection button
    const clearRetailerSelectionBtn = document.getElementById('clear-retailer-selection-btn');
    if (clearRetailerSelectionBtn) {
        clearRetailerSelectionBtn.addEventListener('click', () => {
            if (window.selectedRetailers) window.selectedRetailers.clear();
            renderDashboard();
        });
    }

    // Delete selected button
    const deleteSelectedRetailersBtn = document.getElementById('delete-selected-retailers-btn');
    if (deleteSelectedRetailersBtn) {
        deleteSelectedRetailersBtn.addEventListener('click', async () => {
            if (!window.selectedRetailers || window.selectedRetailers.size === 0) {
                showToast('No retailers selected', 'warning');
                return;
            }
            const count = window.selectedRetailers.size;
            const names = Array.from(window.selectedRetailers);
            let confirmed = false;
            if (typeof Swal !== 'undefined') {
                const result = await Swal.fire({
                    title: `Delete ${count} Retailers?`,
                    html: `Are you sure you want to delete <strong>${count}</strong> selected retailers?<br><span class="text-xs text-red-500 font-medium">This will permanently delete them from the database.</span>`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#dc2626',
                    cancelButtonColor: '#6b7280',
                    confirmButtonText: `Yes, delete ${count}`,
                    cancelButtonText: 'Cancel'
                });
                confirmed = result.isConfirmed;
            } else {
                confirmed = window.confirm(`Are you sure you want to delete ${count} selected retailers?`);
            }

            if (!confirmed) return;

            deleteSelectedRetailersBtn.disabled = true;
            deleteSelectedRetailersBtn.innerHTML = `<span>Deleting ${count}...</span>`;

            try {
                const success = await appState.deleteMultipleRetailers(names);
                if (success) {
                    window.selectedRetailers.clear();
                    renderDashboard();
                }
            } finally {
                deleteSelectedRetailersBtn.disabled = false;
                deleteSelectedRetailersBtn.innerHTML = `
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    <span>Delete Selected</span>
                `;
            }
        });
    }

    // Row Edit / Save / Cancel event delegation
    document.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.edit-retailer-row-btn');
        if (editBtn) {
            const id = editBtn.dataset.id;
            const name = editBtn.dataset.name;
            window.editingRetailerId = id || name;
            window.isEditingRetailerSector = true;
            renderDashboard();
            const input = document.querySelector(`.edit-retailer-name-input[data-id="${id}"]`);
            if (input) input.focus();
            return;
        }

        const cancelBtn = e.target.closest('.cancel-retailer-row-btn');
        if (cancelBtn) {
            window.editingRetailerId = null;
            window.isEditingRetailerSector = false;
            renderDashboard();
            return;
        }

        const saveBtn = e.target.closest('.save-retailer-row-btn');
        if (saveBtn) {
            const rawId = saveBtn.dataset.id;
            const id = rawId && !isNaN(rawId) ? parseInt(rawId, 10) : rawId;
            const originalName = saveBtn.dataset.originalName;
            const row = saveBtn.closest('tr');
            const nameInput = row ? row.querySelector('.edit-retailer-name-input') : null;
            const sectorInput = row ? row.querySelector('.edit-retailer-sector-input') : null;
            const newName = nameInput ? nameInput.value.trim() : '';
            const newSector = sectorInput ? sectorInput.value.trim() : '';

            if (!newName || !newSector) {
                showToast('Retailer Name and Sector cannot be empty', 'error');
                return;
            }

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            const success = await appState.updateRetailer(id, newName, newSector, originalName);
            if (success) {
                window.editingRetailerId = null;
                window.isEditingRetailerSector = false;
                renderDashboard();
            } else {
                saveBtn.disabled = false;
                saveBtn.textContent = '💾 Save';
            }
            return;
        }

        const deleteBtn = e.target.closest('.delete-retailer-row-btn');
        if (deleteBtn) {
            const rawId = deleteBtn.dataset.id;
            const id = rawId && !isNaN(rawId) ? parseInt(rawId, 10) : rawId;
            const name = deleteBtn.dataset.name;
            const sector = deleteBtn.dataset.sector;

            let confirmed = false;
            if (typeof Swal !== 'undefined') {
                const result = await Swal.fire({
                    title: 'Delete Retailer?',
                    html: `Are you sure you want to delete <strong>${escapeHtml(name)}</strong> (${escapeHtml(sector)})?<br><span class="text-xs text-red-500 font-medium">This will permanently delete this retailer from the database.</span>`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#dc2626',
                    cancelButtonColor: '#6b7280',
                    confirmButtonText: 'Yes, delete',
                    cancelButtonText: 'Cancel'
                });
                confirmed = result.isConfirmed;
            } else {
                confirmed = window.confirm(`Are you sure you want to delete retailer "${name}"?`);
            }

            if (!confirmed) return;

            deleteBtn.disabled = true;
            deleteBtn.innerHTML = `<span class="text-xs">Deleting...</span>`;

            const success = await appState.deleteRetailer(id, name);
            if (success) {
                if (window.editingRetailerId && (String(window.editingRetailerId) === String(id) || window.editingRetailerId === name)) {
                    window.editingRetailerId = null;
                    window.isEditingRetailerSector = false;
                }
                renderDashboard();
            } else {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = `
                    <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    <span>Delete</span>
                `;
            }
            return;
        }
    });

    // Add sorting functionality for Bills to Dispatch table
    let dispatchSortColumn = null;
    let dispatchSortDirection = 'asc';

    document.addEventListener('click', (e) => {
        const sortableHeader = e.target.closest('.sortable');
        if (sortableHeader && sortableHeader.closest('#bills-to-dispatch')) {
            const column = sortableHeader.dataset.column;

            // Toggle direction if same column, otherwise reset to ascending
            if (dispatchSortColumn === column) {
                dispatchSortDirection = dispatchSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                dispatchSortColumn = column;
                dispatchSortDirection = 'asc';
            }

            // Sort the bills array
            appState.data.bills.sort((a, b) => {
                let aVal = a[column];
                let bVal = b[column];

                // Handle null/undefined values
                if (aVal == null) aVal = '';
                if (bVal == null) bVal = '';

                // Handle numeric comparison for netAmount
                if (column === 'netAmount') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                    return dispatchSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }

                // Handle date comparison
                if (column === 'billDate') {
                    aVal = new Date(aVal).getTime() || 0;
                    bVal = new Date(bVal).getTime() || 0;
                    return dispatchSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }

                // String comparison (case-insensitive)
                aVal = String(aVal).toLowerCase();
                bVal = String(bVal).toLowerCase();

                if (dispatchSortDirection === 'asc') {
                    return aVal.localeCompare(bVal);
                } else {
                    return bVal.localeCompare(aVal);
                }
            });

            // Update sort indicators
            document.querySelectorAll('#bills-to-dispatch .sortable').forEach(th => {
                const indicator = th.querySelector('.sort-indicator');
                if (th.dataset.column === column) {
                    indicator.textContent = dispatchSortDirection === 'asc' ? '↑' : '↓';
                    th.classList.add('bg-gray-800');
                } else {
                    indicator.textContent = '⇅';
                    th.classList.remove('bg-gray-800');
                }
            });

            // Re-render the table
            renderDashboard();
        }

        // Handle Supplies in Progress table sorting
        if (sortableHeader && sortableHeader.closest('#supplies-in-progress')) {
            const column = sortableHeader.dataset.column;

            // Toggle direction if same column, otherwise reset to ascending
            if (window.supplyProgressSortColumn === column) {
                window.supplyProgressSortDirection = window.supplyProgressSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                window.supplyProgressSortColumn = column;
                window.supplyProgressSortDirection = 'asc';
            }

            // Update sort indicators
            document.querySelectorAll('#supplies-in-progress .sortable').forEach(th => {
                const indicator = th.querySelector('.sort-indicator');
                if (th.dataset.column === column) {
                    indicator.textContent = window.supplyProgressSortDirection === 'asc' ? '↑' : '↓';
                    th.classList.add('bg-gray-200');
                } else {
                    indicator.textContent = '⇅';
                    th.classList.remove('bg-gray-200');
                }
            });

            // Re-render the table
            renderDashboard();
        }

        // Handle Total UGRAI table sorting
        if (sortableHeader && sortableHeader.closest('#total-ugrai-section')) {
            // FORCE column to be retailerName for print by sector sequence
            const column = 'retailerName';

            // Toggle direction if same column, otherwise reset to ascending
            if (window.totalUgraiSortColumn === column) {
                window.totalUgraiSortDirection = window.totalUgraiSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                window.totalUgraiSortColumn = column;
                window.totalUgraiSortDirection = 'asc';
            }

            // Update sort indicators
            document.querySelectorAll('#total-ugrai-section .sortable').forEach(th => {
                const indicator = th.querySelector('.sort-indicator');
                if (th.dataset.column === 'retailerName') {
                    indicator.textContent = window.totalUgraiSortDirection === 'asc' ? '↑' : '↓';
                    th.classList.add('bg-gray-200');
                } else {
                    indicator.textContent = '⇅';
                    th.classList.remove('bg-gray-200');
                }
            });

            // Re-render the Total UGRAI table
            const totalUgraiTable = document.querySelector('#total-ugrai-table');
            if (totalUgraiTable) {
                loadCombinedUgraiData(totalUgraiTable);
            }
        }

        // Handle UGRAI Management table sorting
        if (sortableHeader && sortableHeader.closest('#ugrai-management')) {
            const column = sortableHeader.dataset.column;

            // Toggle direction if same column, otherwise reset to ascending
            if (window.ugraiManagementSortColumn === column) {
                window.ugraiManagementSortDirection = window.ugraiManagementSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                window.ugraiManagementSortColumn = column;
                window.ugraiManagementSortDirection = 'asc';
            }

            // Update sort indicators
            document.querySelectorAll('#ugrai-management .sortable').forEach(th => {
                const indicator = th.querySelector('.sort-indicator');
                if (th.dataset.column === column) {
                    indicator.textContent = window.ugraiManagementSortDirection === 'asc' ? '↑' : '↓';
                    th.classList.add('bg-gray-700');
                } else {
                    indicator.textContent = '⇅';
                    th.classList.remove('bg-gray-700');
                }
            });

            // Re-apply filters which will trigger sorting
            const applyFiltersBtn = document.getElementById('ugrai-mgmt-clear-filters');
            if (applyFiltersBtn) {
                // Trigger the applyFilters function by dispatching an event
                const paymentFilter = document.getElementById('ugrai-mgmt-filter-payment');
                if (paymentFilter) {
                    paymentFilter.dispatchEvent(new Event('change'));
                }
            }
        }

        // Handle Supply Management table sorting
        if (sortableHeader && sortableHeader.closest('#approval-table-section')) {
            const column = sortableHeader.dataset.column;

            // Toggle direction if same column, otherwise reset to ascending
            if (window.supplyManagementSortColumn === column) {
                window.supplyManagementSortDirection = window.supplyManagementSortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                window.supplyManagementSortColumn = column;
                window.supplyManagementSortDirection = 'asc';
            }

            // Update sort indicators
            document.querySelectorAll('#approval-table-section .sortable').forEach(th => {
                const indicator = th.querySelector('.sort-indicator');
                if (th.dataset.column === column) {
                    indicator.textContent = window.supplyManagementSortDirection === 'asc' ? '↑' : '↓';
                    th.classList.add('bg-gray-700');
                } else {
                    indicator.textContent = '⇅';
                    th.classList.remove('bg-gray-700');
                }
            });

            // Reload the table with sorting applied
            loadSupplyManagement();
        }
    });

    if (document.getElementById('download-retailers-btn')) {
        document.getElementById('download-retailers-btn').addEventListener('click', async () => {
            let retailers = appState.data.retailers;
            if (!retailers || retailers.length === 0) {
                if (appState && typeof appState.loadRetailers === 'function') {
                    showToast('Fetching retailer data from database...', 'info');
                    await appState.loadRetailers();
                    retailers = appState.data.retailers || [];
                }
            }
            if (!retailers || retailers.length === 0) {
                showToast('No retailer data found in database to download', 'warning');
                return;
            }
            const csvRows = ['Retailer Name,Sector'];
            retailers.forEach(r => {
                const name = `"${String(r.name || '').replace(/"/g, '""')}"`;
                const sector = `"${String(r.sector || '').replace(/"/g, '""')}"`;
                csvRows.push(`${name},${sector}`);
            });
            const csvContent = '\uFEFF' + csvRows.join('\r\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `retailers-base-file-${new Date().toISOString().slice(0, 10)}.csv`;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
            showToast(`✅ Successfully downloaded all ${retailers.length} retailers as CSV!`, 'success');
        });
    }

    // Print Supplies in Progress button
    if (document.getElementById('print-supplies-progress-btn')) {
        document.getElementById('print-supplies-progress-btn').addEventListener('click', () => {
            printSuppliesInProgress();
        });
    }

    if (submitDispatchBtn) {
        submitDispatchBtn.addEventListener('click', () => {
            console.log('🚀 DISPATCH SUBMIT BUTTON CLICKED');

            // Get selected bills with their corresponding supply-through values
            const selectedBillsData = Array.from(document.querySelectorAll('.dispatch-checkbox:checked'))
                .map(checkbox => {
                    const billId = checkbox.dataset.billId;
                    const row = checkbox.closest('tr');
                    const supplyThroughSelect = row.querySelector('.supply-through-select');
                    const supplyThrough = supplyThroughSelect ? supplyThroughSelect.value : 'Pending Assignment';

                    return {
                        billId: billId,
                        supplyThrough: supplyThrough
                    };
                });

            console.log('📋 Selected bills with supply through data:', selectedBillsData);

            if (selectedBillsData.length > 0) {
                // Check if all bills have a supply through method selected
                const billsWithoutAssignment = selectedBillsData.filter(bill => !bill.supplyThrough || bill.supplyThrough === '');
                if (billsWithoutAssignment.length > 0) {
                    showToast('Please select supply through method for all selected bills.');
                    return;
                }

                appState.moveBillToActiveSuppliesWithAssignments(selectedBillsData);
            } else {
                showToast('Please select at least one bill to submit.');
            }
        });
    }

    // --- Centralized Event Delegation ---
    document.addEventListener('click', async function (e) {
        if (e.target.closest('.supply-done-btn')) {
            const billNumber = e.target.closest('.supply-done-btn').dataset.billNumber;
            const bill = appState.data.activeSupplies.find(b => b.billNumber === billNumber);
            if (bill) {
                openSupplyDoneModal(bill, false); // Pass isEdit mode as false
            } else {
                showToast('Bill not found');
            }
        } else if (e.target.closest('.edit-supply-btn')) {
            const billNumber = e.target.closest('.edit-supply-btn').dataset.billNumber;
            const bill = appState.data.activeSupplies.find(b => b.billNumber === billNumber);
            if (bill) {
                openSupplyDoneModal(bill, true); // Pass isEdit mode as true
            } else {
                showToast('Bill not found');
            }

        } else if (e.target.closest('.ugrai-done-btn')) {
            console.log("Ugrai Done button clicked!");
            const button = e.target.closest('.ugrai-done-btn');
            const billId = button.dataset.billId;
            const billNumber = button.dataset.billNumber;
            console.log("🔍 Ugrai Done Button - Bill ID:", billId, "Bill Number:", billNumber);
            console.log("🔍 Button dataset:", button.dataset);

            // Use comprehensive search to find the bill
            const searchId = billId || billNumber;
            const searchResult = appState.findBillAcrossAllSources(searchId);

            if (searchResult.bill) {
                console.log("✅ Opening Ugrai Done modal for bill:", searchResult.bill.billNumber || searchResult.bill.id);
                openUgraiDoneModal(searchResult.bill, false);
            } else if (searchResult.alreadyCompleted) {
                const completedBill = searchResult.completedBill;
                console.log("ℹ️ Bill already completed:", completedBill.billNumber || completedBill.id);
                showToast(`Bill ${completedBill.billNumber || searchId} was already completed on ${completedBill.dateCompleted || 'unknown date'}`, 'info');
            } else {
                console.error("❌ Ugrai bill not found anywhere!");
                console.log("🔍 Searched for ID/Number:", billId, "/", billNumber);

                // Try ensuring data consistency and searching again
                console.log("🔄 Ensuring data consistency and retrying...");
                await appState.ensureDataConsistency();

                const retryResult = appState.findBillAcrossAllSources(searchId);
                if (retryResult.bill) {
                    console.log("✅ Found bill after data consistency check!");
                    openUgraiDoneModal(retryResult.bill, false);
                } else if (retryResult.alreadyCompleted) {
                    const completedBill = retryResult.completedBill;
                    showToast(`Bill ${completedBill.billNumber || searchId} was already completed on ${completedBill.dateCompleted || 'unknown date'}`, 'info');
                } else {
                    showToast('Ugrai bill not found. Please refresh the page and try again.', 'error');
                }
            }
        }
        else if (e.target.closest('.approve-bill-btn')) {
            const billId = e.target.closest('.approve-bill-btn').dataset.billNumber;
            appState.approveBill(billId);
        } else if (e.target.closest('.edit-approval-btn')) {
            const billNumber = e.target.closest('.edit-approval-btn').dataset.billNumber;
            const bill = appState.data.activeSupplies.find(b => b.billNumber === billNumber);
            if (bill) {
                openSupplyDoneModal(bill, true); // Pass isEdit mode as true
            } else {
                showToast('Bill not found');
            }
        } else if (e.target.closest('.revert-supply-btn')) {
            const billNumber = e.target.closest('.revert-supply-btn').dataset.billNumber;
            if (confirm(`Are you sure you want to revert bill ${billNumber} back to In Progress status?\n\nThis will clear the delivery information (payment method, received amount, completion date).`)) {
                (async () => {
                    try {
                        const result = await appState.supabaseService.revertDeliveredSupplyToInProgress(billNumber);
                        if (result.success) {
                            showToast(result.message, 'success');
                            // Refresh the active supplies data and re-render
                            const activeSupplies = await appState.supabaseService.getActiveSupplies();
                            appState.data.activeSupplies = activeSupplies || [];
                            renderDashboard();
                        } else {
                            showToast(result.message, 'error');
                        }
                    } catch (error) {
                        console.error('Error reverting supply:', error);
                        showToast('Error reverting supply: ' + error.message, 'error');
                    }
                })();
            }
        } else if (e.target.closest('.move-back-btn')) {
            const billId = e.target.closest('.move-back-btn').dataset.billId;
            appState.moveBackToBills(billId);
        } else if (e.target.closest('.remove-temp-bill-btn')) {
            const billId = e.target.closest('.remove-temp-bill-btn').dataset.billId;
            appState.removeTemporaryBill(billId);
        } else if (e.target.closest('.total-card')) {
            const filterMethod = e.target.closest('.total-card').dataset.filterMethod;
            appState.setReportFilter('method', filterMethod);
        } else if (e.target.closest('.report-summary-card[data-filter-method]')) {
            // Handle UGRAI Management card clicks for filtering
            const card = e.target.closest('.report-summary-card[data-filter-method]');
            const filterMethod = card.dataset.filterMethod;
            const paymentFilter = document.getElementById('ugrai-mgmt-filter-payment');
            const personFilter = document.getElementById('ugrai-mgmt-filter-person');
            const retailerFilter = document.getElementById('ugrai-mgmt-filter-retailer');
            const sectorFilter = document.getElementById('ugrai-mgmt-filter-sector');

            // Clear all other filters first for cleaner UX
            if (personFilter) personFilter.value = '';
            if (retailerFilter) retailerFilter.value = '';
            if (sectorFilter) sectorFilter.value = '';

            if (paymentFilter) {
                // Set the payment filter dropdown
                if (filterMethod === 'all') {
                    paymentFilter.value = '';
                } else {
                    paymentFilter.value = filterMethod;
                }
                // Trigger the filter
                paymentFilter.dispatchEvent(new Event('change'));
            }
        } else if (e.target.closest('.add-edited-to-staging-btn')) {
            const billId = e.target.closest('.add-edited-to-staging-btn').dataset.billId;
            const editedAmountInput = document.querySelector(`.edited-net-amount[data-bill-id="${billId}"]`);

            console.log('Add to staging clicked - Bill ID:', billId, 'Type:', typeof billId);
            console.log('Found amount input:', editedAmountInput);
            console.log('Amount value:', editedAmountInput?.value);

            if (!editedAmountInput || !editedAmountInput.value) {
                showToast('Please enter a new net amount', 'error');
                return;
            }
            addEditedBillToStaging(billId, editedAmountInput.value);
        } else if (e.target.closest('#approve-selected-btn')) {
            const selectedBills = Array.from(document.querySelectorAll('.approval-checkbox:checked'))
                .map(checkbox => checkbox.dataset.billNumber);
            if (selectedBills.length > 0) {
                appState.approveSelectedBills(selectedBills);
            } else {
                showToast('Please select at least one bill to approve.');
            }
        }
        else if (e.target.closest('.approve-ugrai-btn')) {
            const billId = e.target.closest('.approve-ugrai-btn').dataset.billId;
            (async () => {
                await appState.approveUgraiBill(billId);
            })();
        } else if (e.target.closest('.edit-ugrai-btn')) {
            console.log("Edit Ugrai button clicked");
            const button = e.target.closest('.edit-ugrai-btn');
            const billId = button.dataset.billId;
            console.log("Bill ID for edit:", billId);

            // Find the bill from completedUgrai
            if (appState.data.completedUgrai && appState.data.completedUgrai.length > 0) {
                console.log("Searching in completedUgrai:", appState.data.completedUgrai);
                const bill = appState.data.completedUgrai.find(b => b.id === billId || b.billNumber === billId);

                if (bill) {
                    console.log("Found bill to edit:", bill);
                    openUgraiDoneModal(bill, true); // Pass isEdit mode as true
                } else {
                    console.error("Ugrai bill not found for ID:", billId);
                    showToast('Ugrai bill not found');
                }
            } else {
                console.error("No completedUgrai array or it's empty");
                showToast('No Ugrai bills available');
            }
        } else if (e.target.closest('.revert-ugrai-btn')) {
            const button = e.target.closest('.revert-ugrai-btn');
            const billId = button.dataset.billId;

            // Find the bill to get its bill number for the confirmation message
            const bill = appState.data.completedUgrai?.find(b => b.id === billId || b.billNumber === billId);
            const billNumber = bill ? bill.billNumber : billId;

            if (confirm(`Are you sure you want to revert bill ${billNumber}? This will move it back to UGRAI Issue or UGRAI In Progress with previous payment data.`)) {
                (async () => {
                    try {
                        console.log(`🔄 Reverting bill ID: ${billId}`);
                        const result = await appState.supabaseService.revertUgraiBill(billId);

                        const destination = result.targetTable === 'ugrai_entries'
                            ? 'UGRAI In Progress'
                            : 'UGRAI Issue';

                        if (result.alreadyExisted) {
                            showToast(`Bill ${result.billNumber} was already in ${destination} - removed duplicate from completed`, 'success');
                        } else {
                            showToast(`Bill ${result.billNumber} successfully reverted to ${destination}`, 'success');
                        }

                        // Reload data to reflect changes
                        await appState.loadCompletedUgrai();

                        // Reload the appropriate table based on destination
                        if (result.targetTable === 'ugrai_entries') {
                            await appState.loadUgraiEntries();
                        } else {
                            await appState.loadUgraiData();
                        }

                        // Refresh the dashboard
                        renderDashboard();

                    } catch (error) {
                        console.error('❌ Error reverting UGRAI bill:', error);
                        showToast(`Error reverting bill: ${error.message}`, 'error');
                    }
                })();
            }
        }
        else if (e.target.id === 'approve-ugrai-selected-btn') {
            const selectedBills = Array.from(document.querySelectorAll('.ugrai-approval-checkbox:checked'))
                .map(checkbox => checkbox.dataset.billId);

            if (selectedBills.length > 0) {
                // Use batch approval for efficiency - calls SQL function once for all bills
                (async () => {
                    const result = await appState.approveUgraiBillsBatch(selectedBills);
                    if (result) {
                        showToast(`${selectedBills.length} ugrai bills approved`, 'success');
                    }
                })();
            } else {
                showToast('Please select at least one bill to approve');
            }
        }
        else if (e.target.id === 'ugrai-approval-select-all') {
            // Handle select all checkbox for UGRAI approval
            const checkboxes = document.querySelectorAll('.ugrai-approval-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = e.target.checked;
            });
        }
    });
    // Add this event listener specifically for the confirm/save button
    // Ugrai form submission is now handled by the form submit handler below

    // Supply Status change handler
    if (document.getElementById('supply-status')) {
        document.getElementById('supply-status').addEventListener('change', function (e) {
            const status = e.target.value;
            const deliveryMethodContainer = document.getElementById('delivery-method-container');
            const editedAmountContainer = document.getElementById('edited-amount-container');
            const deliveryFields = document.getElementById('delivery-fields');
            const photoPreview = document.getElementById('photo-preview');

            // Hide all fields first
            deliveryMethodContainer.classList.add('hidden');
            editedAmountContainer.classList.add('hidden');
            deliveryFields.classList.add('hidden');
            if (photoPreview) photoPreview.classList.add('hidden');

            // Check if we're in edit mode or new entry mode
            const isEditMode = document.getElementById('confirm-supply-btn').textContent === 'Save';

            // Show relevant containers based on status
            if (status === 'Delivered') {
                deliveryMethodContainer.classList.remove('hidden');
                deliveryFields.classList.remove('hidden');
                // Update delivery fields based on current delivery method value
                const currentMethod = document.getElementById('delivery-method').value;
                if (currentMethod) {
                    updateDeliveryFields(currentMethod);
                }
            } else if (status === 'Edited' && isEditMode) {
                // Only show edited amount field when in edit mode (from Supply Management)
                // Not when creating new entry from Supplies in Progress
                editedAmountContainer.classList.remove('hidden');
            }
            // For 'Cancelled' or 'Edited' in new entry mode, no additional fields are shown
        });
    }

    if (deliveryMethodSelect) {
        deliveryMethodSelect.addEventListener('change', (e) => updateDeliveryFields(e.target.value));
    }

    // Supply Done Form Submission
    if (supplyDoneForm) {
        supplyDoneForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const billNumber = document.getElementById('modal-bill-id').value;
            const status = document.getElementById('supply-status').value;
            const isEditMode = document.getElementById('confirm-supply-btn').textContent === 'Save';

            // Clear any previous error messages
            hideAllValidationMessages();

            console.log("Submitting form for bill:", billNumber, "with status:", status, "Edit mode:", isEditMode);

            // Validate required fields
            if (!status) {
                showValidationError('status-error', 'Please select a status');
                return;
            }

            if (status === 'Edited') {
                // For edited status, just update the bill data
                const updates = { status: 'Edited' };

                if (isEditMode) {
                    // In edit mode, update the existing bill in activeSupplies
                    appState.updateBillInPlace(billNumber, updates);
                    closeModal('supply-done-modal');
                    showToast('Bill updated successfully');
                } else {
                    // New entry from supplies in progress
                    appState.updateSupplyStatus(billNumber, updates);
                    closeModal('supply-done-modal');
                    showToast('Bill marked as edited and sent for approval');
                }

            } else if (status === 'Delivered') {
                const deliveryMethod = document.getElementById('delivery-method').value;
                const receivedAmount = document.getElementById('received-amount').value;

                if (!deliveryMethod) {
                    showValidationError('method-error', 'Please select a delivery method');
                    return;
                }

                // Validate received amount
                const bill = appState.data.activeSupplies.find(b => b.billNumber === billNumber);
                if (bill && receivedAmount && parseFloat(receivedAmount) > parseFloat(bill.netAmount)) {
                    showValidationError('amount-error', 'Amount exceeds maximum allowed');
                    return;
                }

                // Validate required fields based on delivery method
                if (['Cash', 'UPI', 'Cheque'].includes(deliveryMethod)) {
                    if (!document.getElementById('receipt-number').value) {
                        showValidationError('receipt-error', 'Receipt number is required');
                        return;
                    }
                    if (!receivedAmount) {
                        showValidationError('amount-error', 'Received amount is required');
                        return;
                    }
                }

                if (deliveryMethod === 'Cheque' && !document.getElementById('cheque-date').value) {
                    showValidationError('cheque-error', 'Cheque date is required');
                    return;
                }

                // Photo validation - required for all delivery methods (Cash, UPI, Cheque, Credit)
                if (['Cash', 'UPI', 'Cheque', 'Credit'].includes(deliveryMethod)) {
                    const photoInput = document.getElementById('photo-upload');
                    const photoPreview = document.getElementById('photo-preview');
                    const hasNewPhoto = photoInput && photoInput.files && photoInput.files.length > 0;
                    const hasExistingPhoto = photoPreview && !photoPreview.classList.contains('hidden');

                    if (!hasNewPhoto && !hasExistingPhoto) {
                        showValidationError('photo-error', 'Photo is required for this payment method');
                        return;
                    }

                    // Additional photo validation - check file type and size if new photo uploaded
                    if (hasNewPhoto) {
                        const file = photoInput.files[0];
                        const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];

                        if (!validTypes.includes(file.type)) {
                            showValidationError('photo-error', 'Please upload a valid image file (JPEG, PNG, GIF, or WebP)');
                            return;
                        }

                        // Check file size (max 5MB)
                        if (file.size > 5 * 1024 * 1024) {
                            showValidationError('photo-error', 'Image file must be smaller than 5MB');
                            return;
                        }
                    }
                }

                const updates = {
                    status: 'Delivered',
                    deliveryMethod: deliveryMethod,
                    receiptNumber: document.getElementById('receipt-number').value,
                    receivedAmount: receivedAmount || bill?.netAmount,
                    chequeDate: document.getElementById('cheque-date').value,
                    photoUploaded: true // Photo is now required for all delivery methods
                };

                // Upload photo to storage if there's a new photo
                const photoUploadPromise = handleSupplyPhotoUpload({ billNumber });

                if (isEditMode) {
                    // In edit mode, update the existing bill in activeSupplies
                    appState.updateBillInPlace(billNumber, updates);
                    closeModal('supply-done-modal');
                    showToast('Bill updated successfully');

                    // Handle photo upload in background
                    if (photoUploadPromise) {
                        photoUploadPromise
                            .then(result => {
                                if (result) {
                                    console.log('📸 Photo uploaded successfully for bill:', billNumber);
                                }
                            })
                            .catch(error => {
                                console.error('❌ Photo upload failed for bill:', billNumber, error);
                            });
                    }
                } else {
                    // New entry from supplies in progress
                    appState.updateSupplyStatus(billNumber, updates);
                    closeModal('supply-done-modal');
                    showToast('Supply completed and sent for approval');

                    // Handle photo upload in background
                    if (photoUploadPromise) {
                        photoUploadPromise
                            .then(result => {
                                if (result) {
                                    console.log('📸 Photo uploaded successfully for bill:', billNumber);
                                }
                            })
                            .catch(error => {
                                console.error('❌ Photo upload failed for bill:', billNumber, error);
                            });
                    }
                }

            } else if (status === 'Cancelled') {
                const updates = { status: 'Cancelled' };

                if (isEditMode) {
                    // In edit mode, update the existing bill in activeSupplies
                    appState.updateBillInPlace(billNumber, updates);
                    closeModal('supply-done-modal');
                    showToast('Bill updated successfully');
                } else {
                    // New entry from supplies in progress
                    appState.updateSupplyStatus(billNumber, updates);
                    closeModal('supply-done-modal');
                    showToast('Supply cancelled and sent for approval');
                }
            }
        });
    }

    // Add photo preview functionality
    if (document.getElementById('photo-upload')) {
        document.getElementById('photo-upload').addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                const reader = new FileReader();
                reader.onload = function (e) {
                    const photoPreview = document.getElementById('photo-preview');
                    if (photoPreview) {
                        const uploadedPhoto = document.getElementById('uploaded-photo');
                        if (uploadedPhoto) {
                            uploadedPhoto.src = e.target.result;
                        }
                        photoPreview.classList.remove('hidden');
                    }
                };
                reader.readAsDataURL(e.target.files[0]);
            }
        });
    }

    // Add validation for received amount
    if (document.getElementById('received-amount')) {
        document.getElementById('received-amount').addEventListener('input', function (e) {
            const billId = document.getElementById('modal-bill-id').value;
            const bill = appState.data.activeSupplies.find(b => b.billNumber === billId);

            if (bill && parseFloat(e.target.value) > parseFloat(bill.netAmount)) {
                e.target.setCustomValidity('Amount received cannot be greater than net amount');
                e.target.reportValidity();
            } else {
                e.target.setCustomValidity('');
            }
        });
    }

    if (reportSearchInput) reportSearchInput.addEventListener('keyup', renderDashboard);
    if (reportDateFilter) reportDateFilter.addEventListener('change', (e) => appState.setReportFilter('date', e.target.value));
    if (exportReportBtn) exportReportBtn.addEventListener('click', () => showToast('Export functionality is mocked. Data would be exported to a CSV/XLS file.'));
    // Add event listener for UGRAI dropdown change and other UGRAI functionality
    document.addEventListener('click', function (e) {
        // Handle UGRAI-specific click events
        if (e.target.id === 'ugrai-file-view-btn') {
            console.log("View button clicked!"); // ADD THIS
            console.log("Current ugraiData:", appState.data.ugraiData);
            const tableContainer = document.getElementById('ugrai-data-table-container');
            if (tableContainer) {
                // FIXED: Always show table and refresh data
                tableContainer.classList.remove('hidden');

                // Refresh the table with current data
                if (appState.data.ugraiData && appState.data.ugraiData.length > 0) {
                    renderUgraiTable(appState.data.ugraiData);
                } else {
                    // Show empty state
                    const ugraiTable = document.getElementById('ugrai-table');
                    if (ugraiTable) {
                        ugraiTable.innerHTML = `<tr><td colspan="5" class="text-center py-4">No Ugrai data available. Please upload a file first.</td></tr>`;
                    }
                }
            }
        } else if (e.target.id === 'download-ugrai-btn') {
            // Download UGRAI data
            document.addEventListener('click', function (e) {
                if (e.target.id === 'download-ugrai-btn') {
                    // Create CSV with proper headers
                    const headers = "Bill Number,Bill Date,Retailer Name,Sector,Net Amount\n";

                    // Safely handle case where ugraiData might not exist
                    const ugraiData = appState.data.ugraiData || [];

                    const csvData = ugraiData.map(item => {
                        return `${(item.billNumber || '')},${(item.billDate || '')},${(item.retailerName || '')},${(item.sector || '')},${(item.netAmount || '0')}`;
                    }).join('\n');

                    downloadCSV('ugrai-data.csv', headers + csvData);
                }
            });
        } else if (e.target.id === 'create-ugrai-from-bills-btn') {
            const selectedBills = Array.from(document.querySelectorAll('.credit-bill-checkbox:checked'))
                .map(checkbox => checkbox.dataset.billId);

            if (selectedBills.length > 0) {
                createUgraiFromCreditBills(selectedBills);
            } else {
                showToast('Please select at least one credit bill');
            }
        }

    });

    // Add event listener for UGRAI data type dropdown
    document.addEventListener('change', function (e) {
        if (e.target.id === 'ugrai-data-type') {
            const ugraiDataSection = document.getElementById('ugrai-data-section');
            const ugraiFromSuppliesSection = document.getElementById('ugrai-from-supplies-section');
            const totalUgraiSection = document.getElementById('total-ugrai-section');

            // Hide all sections first
            if (ugraiDataSection) ugraiDataSection.classList.add('hidden');
            if (ugraiFromSuppliesSection) ugraiFromSuppliesSection.classList.add('hidden');
            if (totalUgraiSection) totalUgraiSection.classList.add('hidden');

            // Show the selected section
            if (e.target.value === 'ugrai-data') {
                if (ugraiDataSection) ugraiDataSection.classList.remove('hidden');
            } else if (e.target.value === 'ugrai-from-supplies') {
                if (ugraiFromSuppliesSection) ugraiFromSuppliesSection.classList.remove('hidden');
                // Reload ugrai entries from database before displaying
                console.log("🔄 Reloading ugrai_entries from database...");
                appState.supabaseService.getUgraiEntries().then(entries => {
                    appState.data.ugraiEntries = entries || [];
                    console.log("✅ Reloaded", entries?.length || 0, "ugrai entries");
                    loadCreditBills(); // Load credit bills when this option is selected
                }).catch(err => {
                    console.error("❌ Error reloading ugrai entries:", err);
                    loadCreditBills(); // Still try to load with existing data
                });
            } else if (e.target.value === 'total-ugrai') {
                if (totalUgraiSection) totalUgraiSection.classList.remove('hidden');
                // Explicitly ensure ugrai-from-supplies section is hidden
                if (ugraiFromSuppliesSection) ugraiFromSuppliesSection.classList.add('hidden');
                // Add small delay to ensure DOM is updated
                setTimeout(() => {
                    loadTotalUgraiData(); // Load all pending ugrai bills
                    ensureUgraiFiltersWork(); // Ensure filters work for total-ugrai section
                }, 10);
            }
        } else if (e.target.id === 'credit-select-all') {
            const checkboxes = document.querySelectorAll('.credit-bill-checkbox');
            checkboxes.forEach(checkbox => {
                checkbox.checked = e.target.checked;
            });
        }
    });

    // Manage persons modal
    document.addEventListener('click', function (e) {
        if (e.target.id === 'clear-all-assignments-btn') {
            // REPLACED: Browser confirm with Sweet Alert
            Swal.fire({
                title: 'Clear All Assignments?',
                text: 'Are you sure you want to clear all assignments and remove all bills from Ugrai in Progress?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#dc2626',
                cancelButtonColor: '#6b7280',
                confirmButtonText: 'Yes, clear all',
                cancelButtonText: 'Cancel'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    await appState.clearAllAssignments();
                    Swal.fire({
                        title: 'Cleared!',
                        text: 'All assignments and in-progress bills have been cleared.',
                        icon: 'success',
                        timer: 2000,
                        showConfirmButton: false
                    });
                }
            });
        } else if (e.target.classList.contains('add-to-ugrai-btn')) {
            const billId = e.target.dataset.billId;
            if (billId) {
                const selectedBills = [billId];
                createUgraiFromCreditBills(selectedBills);
            }
        }
    });
    // Handle sector assignments
    document.addEventListener('change', async function (e) {
        if (e.target.classList.contains('sector-assignment')) {
            const sector = e.target.dataset.sector;
            const person = e.target.value;

            console.log(`🔄 Assignment made: Sector "${sector}" → Person "${person}"`);

            if (sector) {
                // Create an object with just this one assignment
                const assignment = {};

                // If person is empty or "Select Person", remove the assignment
                if (!person || person === 'Select Person' || person === '') {
                    assignment[sector] = null; // This will remove the assignment
                } else {
                    assignment[sector] = person;
                }

                // Update this single assignment with backend persistence
                await appState.assignUgraiToPersons(assignment);
            }
        }
    });

    // Add function to render persons list
    function renderPersonsList() {
        const personsList = document.getElementById('persons-list');
        if (!personsList) return;

        const persons = appState.data.persons || [];
        if (persons.length === 0) {
            personsList.innerHTML = '<li class="text-gray-500 p-2">No persons added yet</li>';
            return;
        }

        personsList.innerHTML = persons.map(person => `
            <li class="flex justify-between items-center p-2 border-b border-gray-200 last:border-0">
                <span>${person}</span>
                <button class="remove-person-btn text-red-600 hover:text-red-800" data-person="${person}">
                    ✕
                </button>
            </li>
        `).join('');
    }

    // Add event listener for UGRAI file upload
    document.addEventListener('change', function (e) {
        if (e.target.id === 'ugrai-base-file-upload') {
            console.log("Ugrai file upload detected!"); // Debug log
            handleUgraiFileUpload(e);
        }
    });
    document.addEventListener('click', function (e) {
        // Handle sub-tab clicks for UGRAI
        if (e.target.classList.contains('sub-heading')) {
            const tabId = e.target.dataset.tabId;

            // If clicking on Ugrai Base File tab, refresh the data display
            if (tabId === 'ugrai-base-file') {
                setTimeout(() => {
                    // Refresh the UGRAI data table if it exists and is visible
                    const tableContainer = document.getElementById('ugrai-data-table-container');
                    if (tableContainer && !tableContainer.classList.contains('hidden')) {
                        if (appState.data.ugraiData && appState.data.ugraiData.length > 0) {
                            renderUgraiTable(appState.data.ugraiData);
                        }
                    }
                    // Also refresh credit bills table
                    renderCreditBillsTable();
                }, 100);
            }

            // If clicking on Total Ugrai tab, refresh the combined data
            if (tabId === 'total-ugrai') {
                setTimeout(() => {
                    const totalUgraiTable = document.querySelector('#total-ugrai-table');
                    if (totalUgraiTable) {
                        // Force background arrays to sort by retailer name so print view inherits it
                        if (appState.data.ugraiData) {
                            appState.data.ugraiData.sort((a, b) => String(a.retailerName || '').localeCompare(String(b.retailerName || '')));
                        }
                        if (appState.data.ugraiEntries) {
                            appState.data.ugraiEntries.sort((a, b) => String(a.retailerName || '').localeCompare(String(b.retailerName || '')));
                        }
                        window.totalUgraiSortColumn = 'retailerName';
                        window.totalUgraiSortDirection = 'asc';
                        loadCombinedUgraiData(totalUgraiTable);
                    }
                }, 100);
            }

            // If clicking on Ugrai Issue tab, make sure content is populated
            if (tabId === 'ugrai-issue') {
                const issueContent = document.getElementById('ugrai-issue');
                if (issueContent && issueContent.children.length < 2) {
                    // Content not populated yet, create it
                    const header = issueContent.querySelector('h3');
                    const headerHTML = header ? header.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai Issue</h3>';
                    issueContent.innerHTML = headerHTML;
                    issueContent.appendChild(createUgraiIssueContent());
                }
                // Use coordinated render to prevent duplicate loading states
                setTimeout(() => {
                    renderUgraiIssueCoordinated();
                }, 100);
            }

            // If clicking on Ugrai In Progress tab
            if (tabId === 'ugrai-in-progress') {
                const inProgressContent = document.getElementById('ugrai-in-progress');
                const staticTable = document.getElementById('ugrai-progress-table');

                // Only create dynamic content if static HTML structure doesn't exist
                if (inProgressContent && !staticTable && inProgressContent.children.length < 2) {
                    // Content not populated yet, create it
                    const header = inProgressContent.querySelector('h3');
                    const headerHTML = header ? header.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai in Progress</h3>';
                    inProgressContent.innerHTML = headerHTML;
                    inProgressContent.appendChild(createUgraiInProgressContent());
                }
                // Always refresh the table
                setTimeout(() => {
                    console.log('🔄 Refreshing Ugrai In Progress table...');
                    console.log('  - ugraiInProgress count:', appState.data?.ugraiInProgress?.length || 0);
                    console.log('  - ugraiAssignments:', Object.keys(appState.data?.ugraiAssignments || {}).length, 'sectors assigned');
                    renderAssignedUgraiBillsTableSync(); // Use sync version for immediate tab render
                }, 100);
            }

            // If clicking on Ugrai Management tab
            if (tabId === 'ugrai-management') {
                setTimeout(() => {
                    // Refresh the completed UGRAI dashboard and tables via main renderDashboard
                    console.log('Refreshing UGRAI Management tab...');
                    renderDashboard();
                }, 100);
            }
        }
    });

    // Modal close listeners
    if (document.getElementById('close-add-retailer-modal')) {
        document.getElementById('close-add-retailer-modal').addEventListener('click', () => closeModal('add-retailer-modal'));
    }
    if (document.getElementById('close-supply-modal')) {
        document.getElementById('close-supply-modal').addEventListener('click', () => closeModal('supply-done-modal'));
    }
    // Ugrai Done Modal Events
    if (document.getElementById('ugrai-payment-method')) {
        document.getElementById('ugrai-payment-method').addEventListener('change', (e) => {
            updateUgraiPaymentFields(e.target.value);
        });
    }

    // In your ugrai-done-form submit handler:
    if (document.getElementById('ugrai-done-form')) {
        document.getElementById('ugrai-done-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            console.log("Ugrai form submitted");

            // Get values
            const billId = document.getElementById('ugrai-modal-bill-id').value;
            const paymentMethod = document.getElementById('ugrai-payment-method').value;
            const receiptNumber = document.getElementById('ugrai-receipt-number').value;
            const receivedAmount = document.getElementById('ugrai-received-amount').value;
            const chequeDate = document.getElementById('ugrai-cheque-date').value;
            const netAmount = document.getElementById('ugrai-modal-net-amount').value;

            // Determine if we're in edit mode
            const isEditMode = document.getElementById('confirm-ugrai-btn').textContent === 'Save';
            console.log("Is edit mode:", isEditMode);

            // Clear previous validation messages
            hideUgraiValidationMessages();

            console.log(`🔍 Starting validation for payment method: ${paymentMethod}`);

            // Validate payment method
            if (!paymentMethod) {
                showUgraiValidationError('ugrai-payment-error', 'Please select a payment method');
                return;
            }

            // Validate received amount
            if (!receivedAmount) {
                showUgraiValidationError('ugrai-amount-error', 'Received amount is required');
                return;
            }

            if (parseFloat(receivedAmount) > parseFloat(netAmount)) {
                showUgraiValidationError('ugrai-amount-error', 'Amount exceeds maximum allowed');
                return;
            }

            // Validate receipt number for Cash, UPI, and Cheque (NEFT doesn't need receipt number)
            if ((paymentMethod === 'Cash' || paymentMethod === 'UPI' || paymentMethod === 'Cheque') && !receiptNumber) {
                showUgraiValidationError('ugrai-receipt-error', 'Receipt number is required');
                return;
            }

            // Validate cheque date for Cheque
            if (paymentMethod === 'Cheque' && !chequeDate) {
                showUgraiValidationError('ugrai-cheque-error', 'Cheque date is required');
                return;
            }

            // Enhanced photo validation
            const photoValidation = validateUgraiPhotoRequirement(paymentMethod, isEditMode);
            if (!photoValidation.isValid) {
                showUgraiValidationError('ugrai-photo-error', photoValidation.errorMessage || photoValidation.message);
                return;
            }

            // Get photo elements for validation
            const photoUpload = document.getElementById('ugrai-photo-upload');
            const photoPreview = document.getElementById('ugrai-photo-preview');

            // Check if photo is required for this payment method (NEFT doesn't need photo)
            const requiresPhoto = (paymentMethod === 'Cash' || paymentMethod === 'UPI' || paymentMethod === 'Cheque');

            // Create update object with all the form values
            const hasNewPhoto = photoUpload && photoUpload.files && photoUpload.files.length > 0;
            const hasExistingPhoto = photoPreview && !photoPreview.classList.contains('hidden');

            const updates = {
                paymentMethod: paymentMethod,
                receiptNumber: receiptNumber,
                receivedAmount: receivedAmount,
                chequeDate: chequeDate,
                photoUploaded: requiresPhoto ? (hasNewPhoto || hasExistingPhoto) : false
            };

            // Upload photo to storage if there's a new photo
            const billNumber = document.getElementById('ugrai-modal-bill-number').textContent;
            const photoUploadPromise = handleUgraiPhotoUpload({ billNumber });

            if (isEditMode) {
                // Use our new method for updates
                console.log("Calling updateUgraiBill with:", billId, updates);
                try {
                    const success = await appState.updateUgraiBill(billId, updates);
                    if (success) {
                        closeModal('ugrai-done-modal');
                        showToast('Ugrai bill updated successfully');

                        // Handle photo upload in background
                        if (photoUploadPromise) {
                            photoUploadPromise
                                .then(result => {
                                    if (result) {
                                        console.log('📸 Ugrai photo uploaded successfully for bill:', billNumber);
                                    }
                                })
                                .catch(error => {
                                    console.error('❌ Ugrai photo upload failed for bill:', billNumber, error);
                                });
                        }
                    } else {
                        showToast('Failed to update Ugrai bill');
                    }
                } catch (error) {
                    console.error('Error updating UGRAI bill:', error);
                    showToast('Failed to update Ugrai bill');
                }
            } else {
                // New completion - add additional required fields
                updates.id = billId;
                updates.billNumber = billNumber;
                updates.retailerName = document.getElementById('ugrai-modal-bill-retailer').textContent;
                updates.sector = document.getElementById('ugrai-modal-bill-sector').value;
                updates.netAmount = netAmount;
                updates.status = 'Completed';
                updates.dateCompleted = new Date().toISOString().split('T')[0];

                // Get assignedTo value with multiple fallbacks
                const assignedTo = document.getElementById('ugrai-modal-assigned-to').value;
                const sector = document.getElementById('ugrai-modal-bill-sector').value;

                console.log("🔍 Retrieved assignedTo from hidden field:", assignedTo);
                console.log("🔍 Bill sector:", sector);
                console.log("🔍 UGRAI Assignments:", appState.data.ugraiAssignments);

                // Try to get assignedTo from sector assignments if not already set
                let finalAssignedTo = assignedTo;
                if (!finalAssignedTo && sector && appState.data.ugraiAssignments) {
                    finalAssignedTo = appState.data.ugraiAssignments[sector];
                    console.log("🔍 Got assignedTo from sector assignment:", finalAssignedTo);
                }

                // Final fallback to current user
                if (!finalAssignedTo) {
                    finalAssignedTo = appState.currentUser?.full_name ||
                        appState.currentUser?.email || null;
                    console.log("🔍 Using current user as fallback:", finalAssignedTo);
                }

                updates.assignedTo = finalAssignedTo;
                console.log("🔍 Final assignedTo value being saved:", updates.assignedTo);

                try {
                    const success = await appState.completeUgraiBill(billId, updates);
                    if (success) {
                        closeModal('ugrai-done-modal');
                        showToast('Ugrai completed successfully');

                        // Handle photo upload in background
                        if (photoUploadPromise) {
                            photoUploadPromise
                                .then(result => {
                                    if (result) {
                                        console.log('📸 Ugrai photo uploaded successfully for bill:', billNumber);
                                    }
                                })
                                .catch(error => {
                                    console.error('❌ Ugrai photo upload failed for bill:', billNumber, error);
                                });
                        }

                        // Navigate to management tab after successful completion
                        setTimeout(() => {
                            const ugraiManagementTab = document.querySelector('[data-tab-id="ugrai-management"]');
                            if (ugraiManagementTab) {
                                ugraiManagementTab.click();
                            }
                        }, 500);
                    } else {
                        showToast('Failed to complete Ugrai');
                    }
                } catch (error) {
                    console.error('Error completing UGRAI bill:', error);
                    showToast('Failed to complete Ugrai');
                }
            }
        });
    }

    if (document.getElementById('close-ugrai-modal')) {
        document.getElementById('close-ugrai-modal').addEventListener('click', () => closeModal('ugrai-done-modal'));
    }
    // Purchase event listeners
    if (document.getElementById('purchase-file-view-btn')) {
        document.getElementById('purchase-file-view-btn').addEventListener('click', () => {
            document.getElementById('purchase-data-table-container').classList.toggle('hidden');
        });
    }

    if (document.getElementById('add-purchase-btn')) {
        document.getElementById('add-purchase-btn').addEventListener('click', () => {
            openPurchaseEntryModal();
        });
    }

    if (document.getElementById('purchase-status')) {
        document.getElementById('purchase-status').addEventListener('change', (e) => {
            const noteContainer = document.getElementById('purchase-note-container');
            const noteField = document.getElementById('purchase-note');
            if (e.target.value === 'Edit') {
                noteContainer.style.display = 'block';
                noteField.required = true;
            } else {
                noteContainer.style.display = 'none';
                noteField.required = false;
            }
        });
    }

    if (document.getElementById('close-purchase-modal')) {
        document.getElementById('close-purchase-modal').addEventListener('click', () => {
            closeModal('purchase-entry-modal');
        });
    }

    if (document.getElementById('purchase-entry-form')) {
        document.getElementById('purchase-entry-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            // Validate required fields
            const requiredFields = [
                'purchase-bill-number',
                'purchase-bill-date',
                'purchase-retailer-name',
                'purchase-taxable-amount',
                'purchase-total-tax',
                'purchase-net-amount',
                'purchase-status'
            ];

            let isValid = true;
            requiredFields.forEach(field => {
                const element = document.getElementById(field);
                if (!element.value) {
                    element.classList.add('border-red-500');
                    isValid = false;
                } else {
                    element.classList.remove('border-red-500');
                }
            });

            // Validate note is required if status is "Edit"
            if (document.getElementById('purchase-status').value === 'Edit') {
                const noteElement = document.getElementById('purchase-note');
                if (!noteElement.value) {
                    noteElement.classList.add('border-red-500');
                    isValid = false;
                    showToast('Note is required when status is Edit');
                } else {
                    noteElement.classList.remove('border-red-500');
                }
            }

            if (!isValid) {
                showToast('Please fill all required fields');
                return;
            }

            // Create entry object from form data
            const entry = {
                uniqueId: document.getElementById('purchase-unique-id').value,
                billNumber: document.getElementById('purchase-bill-number').value,
                billDate: document.getElementById('purchase-bill-date').value,
                retailerName: document.getElementById('purchase-retailer-name').value,
                taxableAmount: parseFloat(document.getElementById('purchase-taxable-amount').value),
                totalTax: parseFloat(document.getElementById('purchase-total-tax').value),
                deduction: parseFloat(document.getElementById('purchase-deduction').value || 0),
                netAmount: parseFloat(document.getElementById('purchase-net-amount').value),
                deductionType: document.getElementById('purchase-deduction-type').value,
                creditNoteNumber: document.getElementById('purchase-credit-note-number').value,
                creditNoteDate: document.getElementById('purchase-credit-note-date').value,
                status: document.getElementById('purchase-status').value,
                note: document.getElementById('purchase-note').value
            };

            // Check if this is an update (edit) or new entry
            const isUpdate = document.getElementById('purchase-submit-btn').textContent === 'Update';

            if (isUpdate) {
                // This is an edit/update
                console.log("Updating existing entry:", entry);

                // Find the existing entry in the array
                const entryIndex = appState.data.purchaseEntries.findIndex(e =>
                    e.uniqueId === entry.uniqueId
                );

                if (entryIndex !== -1) {
                    // Update existing entry
                    appState.data.purchaseEntries[entryIndex] = {
                        ...appState.data.purchaseEntries[entryIndex],
                        ...entry,
                        updatedAt: new Date().toISOString()
                    };

                    console.log("Entry updated:", appState.data.purchaseEntries[entryIndex]);
                    showToast('Purchase entry updated successfully!');
                } else {
                    showToast('Error: Could not find entry to update');
                    console.error("Could not find entry with uniqueId:", entry.uniqueId);
                }
            } else {
                // Add new entry
                await appState.addPurchaseEntry(entry);
                console.log("New entry added");
            }

            console.log("Enhancing tables");
            enhancePurchaseTables(); // Explicitly call here
            closeModal('purchase-entry-modal');
            document.getElementById('purchase-entry-form').reset();

            // If it was an update, reset the submit button text back to "Submit"
            if (isUpdate) {
                const submitBtn = document.getElementById('purchase-submit-btn');
                if (submitBtn) {
                    submitBtn.textContent = 'Submit';
                }
            }
        });
    }
    // Net amount calculation
    function setupNetAmountCalculation() {
        const taxableAmountInput = document.getElementById('purchase-taxable-amount');
        const totalTaxInput = document.getElementById('purchase-total-tax');
        const deductionInput = document.getElementById('purchase-deduction');
        const netAmountInput = document.getElementById('purchase-net-amount');

        function calculateNetAmount() {
            const taxableAmount = parseFloat(taxableAmountInput.value) || 0;
            const totalTax = parseFloat(totalTaxInput.value) || 0;
            const deduction = parseFloat(deductionInput.value) || 0;

            // Net Amount = Taxable Amount + Total Tax - Deduction
            const netAmount = taxableAmount + totalTax - deduction;
            netAmountInput.value = netAmount.toFixed(2);
        }

        // Add change listeners to all inputs that affect the calculation
        taxableAmountInput?.addEventListener('input', calculateNetAmount);
        totalTaxInput?.addEventListener('input', calculateNetAmount);
        deductionInput?.addEventListener('input', calculateNetAmount);
    }

    // Handle edit button clicks in purchase table
    function setupPurchaseEditButtons() {
        console.log("Setting up purchase edit buttons");

        // Verify button functionality by logging when this runs
        document.addEventListener('click', function (e) {
            if (e.target.closest('.edit-purchase-btn')) {
                console.log("Edit button clicked", e.target.closest('.edit-purchase-btn').dataset.entryId);
                const entryId = e.target.closest('.edit-purchase-btn').dataset.entryId;
                editPurchaseEntry(entryId);
            } else if (e.target.closest('.confirm-purchase-btn')) {
                console.log("Confirm button clicked", e.target.closest('.confirm-purchase-btn').dataset.entryId);
                const entryId = e.target.closest('.confirm-purchase-btn').dataset.entryId;
                confirmPurchaseEntry(entryId);
            }
        });
    }

    // Edit purchase entry
    function editPurchaseEntry(entryId) {
        console.log("Edit purchase entry with ID:", entryId);
        console.log("Available entries:", appState.data.purchaseEntries);

        // Try to find by id or uniqueId
        const entry = appState.data.purchaseEntries.find(e =>
            e.id === entryId || e.uniqueId === entryId
        );

        if (!entry) {
            console.error("Entry not found with ID:", entryId);
            showToast('Entry not found');
            return;
        }

        console.log("Found entry to edit:", entry);

        // Open the modal
        openPurchaseEntryModal();

        // Fill the form with entry data
        document.getElementById('purchase-unique-id').value = entry.uniqueId;
        document.getElementById('purchase-bill-number').value = entry.billNumber;
        document.getElementById('purchase-bill-date').value = entry.billDate;
        document.getElementById('purchase-retailer-name').value = entry.retailerName;
        document.getElementById('purchase-taxable-amount').value = entry.taxableAmount;
        document.getElementById('purchase-total-tax').value = entry.totalTax;
        document.getElementById('purchase-deduction').value = entry.deduction || 0;
        document.getElementById('purchase-net-amount').value = entry.netAmount;
        document.getElementById('purchase-deduction-type').value = entry.deductionType || '';
        document.getElementById('purchase-credit-note-number').value = entry.creditNoteNumber || '';
        document.getElementById('purchase-credit-note-date').value = entry.creditNoteDate || '';
        document.getElementById('purchase-status').value = entry.status || 'Received';
        document.getElementById('purchase-note').value = entry.note || '';

        // Show note field if status is Edit
        if (entry.status === 'Edit') {
            document.getElementById('purchase-note-container').style.display = 'block';
        }

        // Change submit button text
        const submitBtn = document.getElementById('purchase-submit-btn');
        if (submitBtn) {
            submitBtn.textContent = 'Update';
        }
    }

    // Confirm purchase entry (move to Purchase Received)
    async function confirmPurchaseEntry(entryId) {
        console.log("Confirming purchase entry with ID:", entryId);

        // Get the entry from purchaseEntries array
        const entryIndex = appState.data.purchaseEntries.findIndex(e =>
            e.id === entryId || e.uniqueId === entryId
        );

        if (entryIndex === -1) {
            console.error("Entry not found for ID:", entryId);
            showToast('Entry not found');
            return;
        }

        const entry = appState.data.purchaseEntries[entryIndex];
        console.log("Found entry to confirm:", entry);

        // Show confirmation dialog
        Swal.fire({
            title: 'Confirm Purchase?',
            text: `Are you sure you want to confirm purchase bill ${entry.billNumber}?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Yes, confirm it',
            cancelButtonText: 'Cancel'
        }).then(async (result) => {
            if (result.isConfirmed) {
                console.log("🔄 Calling AppState confirmPurchaseEntry method for proper Supabase saving");

                // Use the AppState method to ensure Supabase persistence
                await appState.confirmPurchaseEntry(entryId);

                console.log("✅ Purchase entry confirmed via AppState method");

                // Force render dashboard and update tables
                if (typeof window.enhancePurchaseTables === 'function') {
                    window.enhancePurchaseTables();
                } else if (typeof enhancePurchaseTables === 'function') {
                    enhancePurchaseTables();
                }
                renderDashboard();

                // Switch to Purchase Received tab
                setTimeout(() => {
                    const receivedTab = document.querySelector('[data-tab-id="purchase-received"]');
                    if (receivedTab) {
                        receivedTab.click();
                    }
                    showToast('Purchase confirmed successfully!');
                }, 500);
            }
        });
    }
    // Function to mark purchase as accounting entry done
    async function completeAccountEntryProcess(entryId) {
        console.log('🧮 Starting accounting completion for entry:', entryId);

        const entry = appState.data.purchaseEntries.find(e =>
            e.id === entryId || e.uniqueId === entryId
        );

        if (!entry) {
            console.error('❌ Entry not found for accounting completion:', entryId);
            showToast('Entry not found');
            return;
        }

        console.log('🧮 Found entry for accounting:', entry);

        // Create a SweetAlert prompt for Voucher Number
        Swal.fire({
            title: 'Enter Voucher Number',
            input: 'text',
            inputLabel: 'Voucher Number',
            inputPlaceholder: 'Enter voucher number...',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Complete Entry',
            inputValidator: (value) => {
                if (!value) {
                    return 'You need to enter a voucher number!';
                }
            }
        }).then(async (result) => {
            if (result.isConfirmed) {
                const voucherNumber = result.value;
                console.log('🧮 Completing accounting entry with voucher:', voucherNumber);

                // Use AppState method for completion
                await appState.completePurchaseEntry(entryId, voucherNumber);

                console.log('✅ Accounting entry completed successfully');

                // Switch to Purchase Management tab
                setTimeout(() => {
                    const managementTab = document.querySelector('[data-tab-id="purchase-management"]');
                    if (managementTab) {
                        managementTab.click();
                    }
                    showToast('Accounting entry completed successfully!');
                }, 500);
            }
        });
    }
    // Function to mark payment as done
    async function markPaymentDone(entryId) {
        console.log("markPaymentDone called with entryId:", entryId);

        // Find the entry by ID
        const entry = appState.data.purchaseEntries.find(e =>
            e.id === entryId || e.uniqueId === entryId
        );

        if (!entry) {
            console.error("Entry not found with ID:", entryId);
            showToast('Entry not found');
            return;
        }

        console.log("Found entry to mark as paid:", entry);

        // Get cheque details - use existing values or defaults
        const chequeNumber = entry.chequeNumber || '';
        // Use the cheque date if provided, otherwise default to due date
        let chequeDate = entry.chequeDate;
        if (!chequeDate) {
            // Calculate due date based on retailer due days
            const billDate = new Date(entry.billDate);
            const retailer = appState.data.purchaseRetailers.find(r =>
                r.retailerName === entry.retailerName
            );
            const dueDays = retailer ? retailer.dueDays : 30; // Default 30 days if not found
            const dueDate = new Date(billDate);
            dueDate.setDate(billDate.getDate() + dueDays);
            chequeDate = dueDate.toISOString().split('T')[0];
        }

        // Validate cheque number is required
        if (!chequeNumber) {
            showToast('fill cheque no.');
            return;
        }

        // Show confirmation dialog
        Swal.fire({
            title: 'Mark Payment as Done?',
            text: `Are you sure payment for bill ${entry.billNumber} is complete?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#6b7280',
            confirmButtonText: 'Yes, mark as paid',
            cancelButtonText: 'Cancel'
        }).then((result) => {
            if (result.isConfirmed) {
                console.log("Confirmation approved, updating entry");

                // Find the entry index
                const index = appState.data.purchaseEntries.findIndex(e =>
                    e.id === entryId || e.uniqueId === entryId
                );

                if (index !== -1) {
                    // Update status to 'Paid' and set timestamp
                    console.log("Updating entry at index:", index);
                    appState.data.purchaseEntries[index].status = 'Paid';
                    appState.data.purchaseEntries[index].paidAt = new Date().toISOString();

                    // Make sure cheque details are saved
                    appState.data.purchaseEntries[index].chequeNumber = chequeNumber;
                    appState.data.purchaseEntries[index].chequeDate = chequeDate;

                    console.log("Entry updated:", appState.data.purchaseEntries[index]);

                    // Force render tables to update the UI
                    enhancePurchaseTables();
                    renderDashboard();

                    // Switch to Purchased tab
                    setTimeout(() => {
                        const purchasedTab = document.querySelector('[data-tab-id="purchased"]');
                        if (purchasedTab) {
                            purchasedTab.click();
                        }
                        showToast('Payment marked as done successfully!');
                    }, 500);
                } else {
                    console.error("Entry index not found");
                    showToast("Error: Entry not found");
                }
            }
        });
    }
    // Function to view purchase details for a retailer
    function viewPurchaseDetails(retailerName) {
        // Find all paid entries for this retailer
        const paidEntries = appState.data.purchaseEntries.filter(entry =>
            entry.status === 'Paid' && entry.retailerName === retailerName
        );

        if (!paidEntries.length) {
            showToast('No purchase details found for this retailer');
            return;
        }

        // Create HTML table with details
        const tableHtml = `
    <table class="w-full text-sm border-collapse">
        <thead class="text-xs uppercase bg-gray-200">
            <tr>
                <th class="p-2 border">Bill Number</th>
                <th class="p-2 border">Bill Date</th>
                <th class="p-2 border">Net Amount</th>
                <th class="p-2 border">Cheque No.</th>
                <th class="p-2 border">Cheque Date</th>
                <th class="p-2 border">Payment Date</th>
            </tr>
        </thead>
        <tbody>
            ${paidEntries.map(entry => `
                <tr>
                    <td class="p-2 border">${entry.billNumber}</td>
                    <td class="p-2 border">${entry.billDate}</td>
                    <td class="p-2 border">₹${parseFloat(entry.netAmount).toFixed(2)}</td>
                    <td class="p-2 border">${entry.chequeNumber || '-'}</td>
                    <td class="p-2 border">${entry.chequeDate || '-'}</td>
                    <td class="p-2 border">${new Date(entry.paidAt).toLocaleDateString()}</td>
                </tr>
            `).join('')}
        </tbody>
        <tfoot>
            <tr class="font-bold">
                <td colspan="2" class="p-2 border text-right">Total:</td>
                <td class="p-2 border">₹${paidEntries.reduce((sum, entry) => sum + parseFloat(entry.netAmount || 0), 0).toFixed(2)}</td>
                <td colspan="3" class="p-2 border"></td>
            </tr>
        </tfoot>
    </table>
    `;

        // Show in a SweetAlert modal
        Swal.fire({
            title: `Purchase Details: ${retailerName}`,
            html: tableHtml,
            width: '800px',
            showConfirmButton: true,
            confirmButtonText: 'Close',
            confirmButtonColor: '#dc2626'
        });
    }

    // Make enhancePurchaseTables globally available
    window.enhancePurchaseTables = function enhancePurchaseTables() {
        console.log("Enhancing purchase tables with entries:", appState.data.purchaseEntries);

        // Log all entries with their statuses
        appState.data.purchaseEntries.forEach((entry, index) => {
            console.log(`Entry ${index}:`, entry.billNumber, "Status:", entry.status);
        });

        // Purchase Received Table - Show Confirmed entries
        const purchaseReceivedTable = document.getElementById('purchase-received-table');
        if (purchaseReceivedTable) {
            console.log("Updating purchase-received-table");

            // Get all entries with 'Confirmed' status
            console.log("🔍 All purchase entries:", appState.data.purchaseEntries);
            console.log("🔍 Filtering for Confirmed status...");

            const confirmedEntries = appState.data.purchaseEntries.filter(entry => {
                console.log(`🔍 Entry ${entry.billNumber}: status = "${entry.status}"`);
                return entry.status === 'Confirmed';
            });

            console.log("✅ Confirmed entries found:", confirmedEntries.length);
            console.log("🧮 Confirmed entries:", confirmedEntries);

            if (confirmedEntries.length > 0) {
                // If there are confirmed entries, show them in the table
                purchaseReceivedTable.innerHTML = confirmedEntries.map(entry => `
                <tr class="table-row">
                    <td data-label="Bill Number">${entry.billNumber || ''}</td>
                    <td data-label="Bill Date">${entry.billDate || ''}</td>
                    <td data-label="Retailer Name">${entry.retailerName || ''}</td>
                    <td data-label="Taxable Amount">₹${(entry.taxableAmount || 0).toFixed(2)}</td>
                    <td data-label="Total Tax">₹${(entry.totalTax || 0).toFixed(2)}</td>
                    <td data-label="Deduction">₹${(entry.deduction || 0).toFixed(2)}</td>
                    <td data-label="Net Amount">₹${(entry.netAmount || 0).toFixed(2)}</td>
                    <td data-label="Status">${entry.status || ''}</td>
                    <td data-label="Note">${entry.note || '-'}</td>
                    <td data-label="Actions">
                        <button class="account-entry-done-btn px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors duration-300 text-xs" 
                            data-entry-id="${entry.id || entry.uniqueId}">A/c Entry Done</button>
                    </td>
                </tr>
            `).join('');

                // Add event listeners to newly created buttons
                setTimeout(() => {
                    document.querySelectorAll('.account-entry-done-btn').forEach(button => {
                        button.addEventListener('click', function () {
                            const entryId = this.dataset.entryId;
                            completeAccountEntryProcess(entryId);
                        });
                    });
                }, 100);

            } else {
                // If there are no confirmed entries, show a message
                purchaseReceivedTable.innerHTML = '<tr><td colspan="10" class="text-center py-4">No confirmed purchases found</td></tr>';
            }
        }

        // Add filter input above the Purchase Management table
        const purchaseManagementSection = document.getElementById('purchase-management');
        if (purchaseManagementSection) {
            // Check if filter already exists to avoid duplicates
            if (!document.getElementById('purchase-management-retailer-filter')) {
                const tableContainer = purchaseManagementSection.querySelector('.table-container');

                // Add the filter input before the table
                if (tableContainer) {
                    const filterDiv = document.createElement('div');
                    filterDiv.className = 'flex justify-end mb-4';
                    filterDiv.innerHTML = `
                <input type="text" id="purchase-management-retailer-filter" placeholder="Filter by Retailer..."
                    class="compact-input w-64 bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
            `;

                    // Insert the filter before the table container
                    tableContainer.parentNode.insertBefore(filterDiv, tableContainer);
                }
            }
        }
        // Purchase Management Table - Show both Confirmed and Completed entries
        const purchaseManagementTable = document.getElementById('purchase-management-table');
        if (purchaseManagementTable) {
            // Filter entries with status = 'Confirmed' OR 'Completed'
            const managementEntries = (appState.data.purchaseEntries || [])
                .filter(entry => entry.status === 'Completed' || entry.status === 'Confirmed')
                .map(entry => {
                    // Calculate due date based on retailer due days
                    const billDate = new Date(entry.billDate);
                    const retailer = appState.data.purchaseRetailers.find(r =>
                        r.retailerName === entry.retailerName
                    );
                    const dueDays = retailer ? retailer.dueDays : 30; // Default 30 days if not found
                    const dueDate = new Date(billDate);
                    dueDate.setDate(billDate.getDate() + dueDays);

                    // Add dueDate to entry
                    return {
                        ...entry,
                        dueDate: dueDate.toISOString().split('T')[0],
                        dueDateObj: dueDate // For sorting
                    };
                })
                .sort((a, b) => a.dueDateObj - b.dueDateObj); // Sort by nearest due date

            // Calculate total due amount (only Completed entries, not Confirmed)
            const totalDueAmount = managementEntries
                .filter(entry => entry.status === 'Completed')
                .reduce((sum, entry) => sum + parseFloat(entry.netAmount || 0), 0);

            // Update total due amount display
            const totalDueElement = document.getElementById('total-due-amount');
            if (totalDueElement) {
                totalDueElement.textContent = `₹${totalDueAmount.toFixed(2)}`;
            }

            // Calculate day-wise due amounts (only Completed entries)
            const dayWiseDue = {};
            managementEntries
                .filter(entry => entry.status === 'Completed')
                .forEach(entry => {
                    const dueDate = entry.dueDate;
                    if (!dayWiseDue[dueDate]) {
                        dayWiseDue[dueDate] = {
                            date: dueDate,
                            amount: 0,
                            count: 0
                        };
                    }
                    dayWiseDue[dueDate].amount += parseFloat(entry.netAmount || 0);
                    dayWiseDue[dueDate].count += 1;
                });

            // Convert to array and sort by date
            const sortedDayWise = Object.values(dayWiseDue)
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            // Render day-wise due cards
            const dayWiseContainer = document.getElementById('daywise-due-container');
            if (dayWiseContainer) {
                dayWiseContainer.innerHTML = sortedDayWise.map((item, index) => {
                    const dateObj = new Date(item.date);
                    const formattedDate = dateObj.toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                    });

                    return `
            <div class="flex-shrink-0 min-w-[140px] bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer due-date-card" 
                 data-due-date="${item.date}">
                <p class="text-xs font-medium text-gray-600 mb-1">${formattedDate}</p>
                <p class="text-lg font-bold text-gray-800">₹${item.amount.toFixed(2)}</p>
                <p class="text-xs text-gray-500">${item.count} bill${item.count > 1 ? 's' : ''}</p>
            </div>
        `;
                }).join('') || '<p class="text-gray-500 text-sm">No pending dues</p>';

                // Add click event listeners after DOM updates
                setTimeout(() => {
                    // Add click listener to Total Due Amount card
                    const totalDueCard = document.querySelector('[id="total-due-amount"]').closest('div');
                    if (totalDueCard) {
                        totalDueCard.style.cursor = 'pointer';
                        totalDueCard.addEventListener('click', function () {
                            // Remove active state from all cards
                            document.querySelectorAll('.due-date-card').forEach(c => {
                                c.classList.remove('bg-red-50', 'border-red-400');
                                c.classList.add('bg-white', 'border-gray-200');
                            });
                            // Show all entries
                            filterPurchaseManagementTable(null);
                        });
                    }

                    // Add click listeners to due date cards
                    document.querySelectorAll('.due-date-card').forEach(card => {
                        card.addEventListener('click', function () {
                            const selectedDate = this.dataset.dueDate;

                            // Remove active state from all cards
                            document.querySelectorAll('.due-date-card').forEach(c => {
                                c.classList.remove('bg-red-50', 'border-red-400');
                                c.classList.add('bg-white', 'border-gray-200');
                            });

                            // Add active state to clicked card
                            this.classList.remove('bg-white', 'border-gray-200');
                            this.classList.add('bg-red-50', 'border-red-400');

                            // Filter table to show only entries with this due date
                            filterPurchaseManagementTable(selectedDate);
                        });
                    });
                }, 100);
            }

            if (managementEntries.length > 0) {
                purchaseManagementTable.innerHTML = managementEntries.map(entry => {
                    // Show appropriate UI based on entry status
                    const isConfirmed = entry.status === 'Confirmed';

                    // Different action button based on status
                    let actionButton = '';
                    let accountingIcon = '';
                    let inputsDisabled = '';

                    if (isConfirmed) {
                        // For Confirmed entries, show NO button (blank action cell)
                        actionButton = ''; // Leave blank
                        accountingIcon = `<span class="inline-block w-6 h-6 bg-yellow-500 rounded-full text-white text-center">⏳</span>`;
                        inputsDisabled = 'disabled';
                    } else {
                        // For Completed entries, show Payment Done button
                        actionButton = `
                        <button class="payment-done-btn px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors duration-300 text-xs"
                                data-entry-id="${entry.id || entry.uniqueId}">Payment Done</button>
                    `;
                        accountingIcon = `<span class="inline-block w-6 h-6 bg-green-500 rounded-full text-white text-center">✓</span>`;
                        inputsDisabled = '';
                    }

                    return `
                <tr class="table-row">
                    <td data-label="Bill Number">${entry.billNumber || ''}</td>
                    <td data-label="Bill Date">${entry.billDate || ''}</td>
                    <td data-label="Retailer Name">${entry.retailerName || ''}</td>
                    <td data-label="Taxable Amount">₹${(entry.taxableAmount || 0).toFixed(2)}</td>
                    <td data-label="Total Tax">₹${(entry.totalTax || 0).toFixed(2)}</td>
                    <td data-label="Deduction">₹${(entry.deduction || 0).toFixed(2)}</td>
                    <td data-label="Net Amount">₹${(entry.netAmount || 0).toFixed(2)}</td>
                    <td data-label="A/c Entry">${accountingIcon}</td>
                    <td data-label="Due Date">${entry.dueDate}</td>
                    <td data-label="Cheque No.">
                        <input type="text" class="cheque-number-input w-full bg-gray-100 rounded border border-gray-300 focus:outline-none focus:border-red-600 px-2 py-1"
                               data-entry-id="${entry.id || entry.uniqueId}" 
                               value="${entry.chequeNumber || ''}" ${inputsDisabled}>
                    </td>
                    <td data-label="Cheque Date">
                        <input type="date" class="cheque-date-input w-full bg-gray-100 rounded border border-gray-300 focus:outline-none focus:border-red-600 px-2 py-1"
                               data-entry-id="${entry.id || entry.uniqueId}" 
                               value="${entry.chequeDate || entry.dueDate}" ${inputsDisabled}>
                    </td>
                    <td data-label="Actions">${actionButton}</td>
                </tr>
                `;
                }).join('');

                // Add event listeners to payment-done buttons directly
                setTimeout(() => {
                    document.querySelectorAll('.payment-done-btn').forEach(button => {
                        button.addEventListener('click', function () {
                            console.log("Payment Done button clicked via addEventListener");
                            const entryId = this.dataset.entryId;
                            console.log("Entry ID from addEventListener:", entryId);
                            markPaymentDone(entryId);
                        });
                    });
                }, 100);

                // Add input change event handlers (only for enabled inputs)
                document.querySelectorAll('.cheque-number-input:not([disabled]), .cheque-date-input:not([disabled])').forEach(input => {
                    input.addEventListener('change', function (e) {
                        const entryId = e.target.dataset.entryId;
                        const field = e.target.classList.contains('cheque-number-input') ? 'chequeNumber' : 'chequeDate';
                        const value = e.target.value;

                        // Update in appState
                        const entryIndex = appState.data.purchaseEntries.findIndex(entry =>
                            (entry.id === entryId || entry.uniqueId === entryId)
                        );

                        if (entryIndex !== -1) {
                            appState.data.purchaseEntries[entryIndex][field] = value;
                        }
                    });
                });
            } else {
                purchaseManagementTable.innerHTML = '<tr><td colspan="12" class="text-center py-4">No entries for payment management</td></tr>';
            }
        }

        // Purchased Tab
        const purchasedTable = document.getElementById('purchased-table');
        if (purchasedTable) {
            // Filter entries with Paid status
            const paidEntries = (appState.data.purchaseEntries || [])
                .filter(entry => entry.status === 'Paid')
                .sort((a, b) => new Date(b.paidAt || 0) - new Date(a.paidAt || 0)); // Sort newest first

            if (paidEntries.length > 0) {
                purchasedTable.innerHTML = paidEntries.map(entry => `
            <tr class="table-row">
                <td data-label="Bill Number">${entry.billNumber || ''}</td>
                <td data-label="Bill Date">${entry.billDate || ''}</td>
                <td data-label="Retailer Name">${entry.retailerName || ''}</td>
                <td data-label="Net Amount">₹${(entry.netAmount || 0).toFixed(2)}</td>
                <td data-label="Voucher Number">${entry.voucherNumber || 'N/A'}</td>
                <td data-label="Cheque No.">${entry.chequeNumber || 'N/A'}</td>
                <td data-label="Cheque Date">${entry.chequeDate || 'N/A'}</td>
                <td data-label="Payment Date">${new Date(entry.paidAt).toLocaleDateString() || 'N/A'}</td>
            </tr>
        `).join('');
            }
            else {
                purchasedTable.innerHTML = '<tr><td colspan="8" class="text-center py-4">No paid purchases found</td></tr>';
            }// Calculate total payment and month-wise payments
            const totalPayment = paidEntries.reduce((sum, entry) =>
                sum + parseFloat(entry.netAmount || 0), 0
            );

            // Update total payment display
            const totalPaymentElement = document.getElementById('total-payment-amount');
            if (totalPaymentElement) {
                totalPaymentElement.textContent = `₹${totalPayment.toFixed(2)}`;
            }

            // Calculate month-wise payments
            const monthWisePayments = {};
            paidEntries.forEach(entry => {
                const paymentDate = new Date(entry.paidAt);
                const monthKey = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
                const monthName = paymentDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

                if (!monthWisePayments[monthKey]) {
                    monthWisePayments[monthKey] = {
                        monthKey: monthKey,
                        monthName: monthName,
                        amount: 0,
                        count: 0
                    };
                }

                monthWisePayments[monthKey].amount += parseFloat(entry.netAmount || 0);
                monthWisePayments[monthKey].count += 1;
            });

            // Sort by month (latest first) and render
            const sortedMonths = Object.values(monthWisePayments)
                .sort((a, b) => b.monthKey.localeCompare(a.monthKey));

            const monthWiseContainer = document.getElementById('monthwise-payment-container');
            if (monthWiseContainer) {
                monthWiseContainer.innerHTML = sortedMonths.map(month => `
            <div class="flex-shrink-0 min-w-[140px] bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer month-payment-card" 
                 data-month="${month.monthKey}">
                <p class="text-xs font-medium text-gray-600 mb-1">${month.monthName}</p>
                <p class="text-lg font-bold text-gray-800">₹${month.amount.toFixed(2)}</p>
                <p class="text-xs text-gray-500">${month.count} payment${month.count > 1 ? 's' : ''}</p>
            </div>
        `).join('') || '<p class="text-gray-500 text-sm">No payments made</p>';

                // Add click event listeners
                setTimeout(() => {
                    // Total payment card click
                    const totalCard = document.getElementById('total-payment-card');
                    if (totalCard) {
                        totalCard.addEventListener('click', function () {
                            filterPurchasedTable(null, null);
                            document.querySelectorAll('.month-payment-card').forEach(c => {
                                c.classList.remove('bg-green-50', 'border-green-400');
                                c.classList.add('bg-white', 'border-gray-200');
                            });
                        });
                    }

                    // Month cards click
                    document.querySelectorAll('.month-payment-card').forEach(card => {
                        card.addEventListener('click', function () {
                            const selectedMonth = this.dataset.month;

                            document.querySelectorAll('.month-payment-card').forEach(c => {
                                c.classList.remove('bg-green-50', 'border-green-400');
                                c.classList.add('bg-white', 'border-gray-200');
                            });

                            this.classList.remove('bg-white', 'border-gray-200');
                            this.classList.add('bg-green-50', 'border-green-400');

                            filterPurchasedTable(null, selectedMonth);
                        });
                    });
                }, 100);
            }

        }

        // Helper function for date formatting
        function formatDate(dateString) {
            if (!dateString) return 'N/A';
            try {
                const date = new Date(dateString);
                return date.toLocaleDateString();
            } catch (e) {
                return dateString || 'N/A';
            }
        }

        // Purchase Entry Table - Show entries that are neither Confirmed, Completed, nor Paid
        const purchaseEntryTable = document.getElementById('purchase-entry-table');
        if (purchaseEntryTable) {
            console.log("Updating purchase-entry-table");

            // CHANGED: Filter to exclude Confirmed, Completed and Paid entries
            const entries = [...(appState.data.purchaseEntries || [])]
                .filter(entry => entry.status !== 'Confirmed' && entry.status !== 'Completed' && entry.status !== 'Paid')
                .sort((a, b) => {
                    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
                });

            console.log("Entries for purchase entry table:", entries);

            purchaseEntryTable.innerHTML = entries.length > 0
                ? entries.map(entry => {
                    console.log("Rendering entry:", entry.id, entry);
                    return `
        <tr class="table-row">
            <td data-label="Bill Number">${entry.billNumber || ''}</td>
            <td data-label="Bill Date">${entry.billDate || ''}</td>
            <td data-label="Retailer Name">${entry.retailerName || ''}</td>
            <td data-label="Taxable Amount">₹${(entry.taxableAmount || 0).toFixed(2)}</td>
            <td data-label="Total Tax">₹${(entry.totalTax || 0).toFixed(2)}</td>
            <td data-label="Deduction">₹${(entry.deduction || 0).toFixed(2)}</td>
            <td data-label="Net Amount">₹${(entry.netAmount || 0).toFixed(2)}</td>
            <td data-label="Status">${entry.status || ''}</td>
            <td data-label="Note">${entry.note || '-'}</td>
            <td data-label="Actions">
                <div class="flex gap-1 flex-wrap">
                    <button class="edit-purchase-btn px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors duration-300 text-xs" 
                        data-entry-id="${entry.id || entry.uniqueId}">Edit</button>
                    <button class="confirm-purchase-btn px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors duration-300 text-xs" 
                        data-entry-id="${entry.id || entry.uniqueId}">Confirm</button>
                </div>
            </td>
        </tr>
    `}).join('')
                : '<tr><td colspan="10" class="text-center py-4">No entries found</td></tr>';

            // Add event listeners for the entry table buttons
            setTimeout(() => {
                document.querySelectorAll('.edit-purchase-btn').forEach(button => {
                    button.addEventListener('click', function () {
                        const entryId = this.dataset.entryId;
                        editPurchaseEntry(entryId);
                    });
                });

                document.querySelectorAll('.confirm-purchase-btn').forEach(button => {
                    button.addEventListener('click', function () {
                        const entryId = this.dataset.entryId;
                        confirmPurchaseEntry(entryId);
                    });
                });
            }, 100);
        }
    }


    function filterPurchaseManagementTable(dueDate) {
        const table = document.getElementById('purchase-management-table');
        if (!table) return;

        const rows = table.getElementsByTagName('tr');
        const retailerFilter = document.getElementById('purchase-management-retailer-filter');
        const retailerFilterValue = retailerFilter ? retailerFilter.value.toLowerCase() : '';

        for (let row of rows) {
            let showDueToDate = dueDate === null;
            let showDueToRetailer = true;

            // Check due date filter
            if (dueDate !== null) {
                const dueDateCell = row.cells[8]; // Due Date is in the 9th column (index 8)
                if (dueDateCell) {
                    const rowDueDate = dueDateCell.textContent.trim();
                    if (rowDueDate === dueDate) {
                        showDueToDate = true;
                    }
                }
            }

            // Check retailer filter
            if (retailerFilterValue) {
                const retailerCell = row.cells[2]; // Retailer Name is in the 3rd column (index 2)
                if (retailerCell) {
                    const retailerName = retailerCell.textContent.toLowerCase();
                    if (!retailerName.includes(retailerFilterValue)) {
                        showDueToRetailer = false;
                    }
                }
            }

            // Show row only if it passes both filters
            row.style.display = (showDueToDate && showDueToRetailer) ? '' : 'none';
        }
    }
    function filterPurchasedTable(retailerFilter, monthFilter) {
        const table = document.getElementById('purchased-table');
        if (!table) return;

        const rows = table.getElementsByTagName('tr');
        const filterInput = document.getElementById('purchased-filter').value.toLowerCase();
        const dateFilter = document.getElementById('purchased-date-filter').value;

        for (let row of rows) {
            let showRow = true;

            // Apply retailer filter from input
            if (filterInput) {
                const retailerCell = row.cells[2]; // Retailer Name column
                if (retailerCell) {
                    const retailerName = retailerCell.textContent.toLowerCase();
                    if (!retailerName.includes(filterInput)) {
                        showRow = false;
                    }
                }
            }

            // Apply date filter from input
            if (dateFilter && showRow) {
                const billDateCell = row.cells[1]; // Bill Date column
                if (billDateCell) {
                    const billDate = billDateCell.textContent.trim();
                    if (billDate !== dateFilter) {
                        showRow = false;
                    }
                }
            }

            // Apply month filter from card click
            if (monthFilter && showRow) {
                const paymentDateCell = row.cells[6]; // Payment Date column
                if (paymentDateCell) {
                    const paymentDate = new Date(paymentDateCell.textContent);
                    const rowMonth = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
                    if (!rowMonth.includes(monthFilter)) {
                        showRow = false;
                    }
                }
            }

            row.style.display = showRow ? '' : 'none';
        }
    }

    if (document.getElementById('download-purchase-btn')) {
        document.getElementById('download-purchase-btn').addEventListener('click', () => {
            const csvData = appState.data.purchaseRetailers.map(r =>
                `${r.retailerName},${r.dueDays}`
            ).join('\n');
            const header = "Retailer Name,Due Days\n";
            downloadCSV('purchase-retailers.csv', header + csvData);
        });
    }

    if (document.getElementById('purchase-base-file-upload')) {
        console.log('✅ Purchase file upload event listener attached');
        document.getElementById('purchase-base-file-upload').addEventListener('change', async (e) => {
            console.log('📁 Purchase file upload triggered');
            const file = e.target.files[0];
            if (!file) {
                console.log('❌ No file selected');
                return;
            }

            console.log('📄 File selected:', file.name, 'Size:', file.size, 'Type:', file.type);

            const validExtensions = ['xlsx', 'xls'];
            const fileExtension = file.name.split('.').pop().toLowerCase();
            if (!validExtensions.includes(fileExtension)) {
                console.log('❌ Invalid file extension:', fileExtension);
                showToast('Please upload an Excel file (.xlsx or .xls)');
                return;
            }

            try {
                console.log('📖 Reading Excel file...');
                const rows = await readXlsxFile(file);
                console.log('📊 Excel data loaded:', rows?.length || 0, 'rows');

                if (!rows || rows.length < 2) {
                    console.log('❌ Excel file is empty or has no data rows');
                    showToast('Excel file is empty or contains only headers.');
                    return;
                }

                const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
                console.log('📋 Headers found:', headers);

                const retailerNameIndex = headers.findIndex(h => h === 'retailer name');
                const dueDaysIndex = headers.findIndex(h => h === 'due days');

                if (retailerNameIndex === -1 || dueDaysIndex === -1) {
                    console.log('❌ Missing required columns. Retailer Name index:', retailerNameIndex, 'Due Days index:', dueDaysIndex);
                    showToast('Missing required columns: Retailer Name, Due Days');
                    return;
                }

                const retailers = [];
                for (let i = 1; i < rows.length; i++) {
                    const row = rows[i];
                    const retailerName = String(row[retailerNameIndex] || '').trim();
                    const dueDays = parseInt(row[dueDaysIndex]) || 0;

                    if (retailerName) {
                        retailers.push({ retailerName, dueDays });
                    }
                }

                console.log('🏪 Parsed retailers:', retailers);
                console.log('💾 Saving retailers to app state...');
                await appState.setPurchaseRetailers(retailers);
                console.log('✅ Purchase retailers saved successfully');

                // Debug: Check if data was actually saved
                console.log('🔍 Verifying saved data:', appState.data.purchaseRetailers);
                console.log('🔍 Data length:', appState.data.purchaseRetailers?.length);

                // Debug: Check table container visibility and force it to be visible
                const tableContainer = document.getElementById('purchase-data-table-container');
                console.log('🔍 Table container exists:', !!tableContainer);
                console.log('🔍 Table container hidden (before):', tableContainer?.classList.contains('hidden'));

                // Ensure table is visible after upload
                if (tableContainer) {
                    tableContainer.classList.remove('hidden');
                    console.log('👀 Forced table container to be visible');
                }

                // Debug: Check if table element exists and final verification
                const table = document.getElementById('purchase-retailer-table');
                console.log('🔍 Table element exists:', !!table);

                // Add a small delay to check final state after all rendering is complete
                setTimeout(() => {
                    const finalTable = document.getElementById('purchase-retailer-table');
                    const finalContainer = document.getElementById('purchase-data-table-container');
                    console.log('🔍 FINAL CHECK - Table innerHTML:', finalTable?.innerHTML);
                    console.log('🔍 FINAL CHECK - Container visible:', !finalContainer?.classList.contains('hidden'));
                    console.log('🔍 FINAL CHECK - App state data:', appState.data.purchaseRetailers?.length);
                }, 100);

                showToast(`${retailers.length} purchase retailers uploaded successfully!`);
                e.target.value = '';

            } catch (error) {
                console.error("❌ Purchase file error:", error);
                showToast(`Error: ${error.message || 'Failed to read the Excel file'}`);
            }
        });
    } else {
        console.log('❌ Purchase file upload element not found');
    }

    if (document.getElementById('purchased-filter')) {
        document.getElementById('purchased-filter').addEventListener('keyup', () => {
            filterPurchasedTable(null, null);
        });
    }

    if (document.getElementById('purchased-date-filter')) {
        document.getElementById('purchased-date-filter').addEventListener('change', () => {
            filterPurchasedTable(null, null);
        });
    }

    // Add event listener for Purchase Management retailer filter
    if (document.getElementById('purchase-management-retailer-filter')) {
        document.getElementById('purchase-management-retailer-filter').addEventListener('keyup', function () {
            const filterValue = this.value.toLowerCase();

            // 1. Filter the table
            const table = document.getElementById('purchase-management-table');
            if (table) {
                const rows = table.querySelectorAll('tr:not(:first-child)'); // Skip header row
                let filteredTotal = 0;

                // Create an object to track filtered amounts by date
                const filteredDayWise = {};

                rows.forEach(row => {
                    if (row.cells.length > 0) {
                        const retailerCell = row.cells[2]; // Retailer Name is in the 3rd column (index 2)
                        const netAmountCell = row.cells[6]; // Net Amount is in the 7th column (index 6)
                        const dueDateCell = row.cells[8]; // Due Date is in the 9th column (index 8)

                        if (retailerCell && netAmountCell && dueDateCell) {
                            const retailerName = retailerCell.textContent.toLowerCase();
                            const netAmount = parseFloat(netAmountCell.textContent.replace(/[^\d.-]/g, '') || 0);
                            const dueDate = dueDateCell.textContent.trim();

                            // Check if row matches filter
                            const matches = retailerName.includes(filterValue);

                            // Show/hide the row
                            row.style.display = matches ? '' : 'none';

                            // Add to totals if matches filter
                            if (matches) {
                                filteredTotal += netAmount;

                                // Add to day-wise totals
                                if (!filteredDayWise[dueDate]) {
                                    filteredDayWise[dueDate] = {
                                        date: dueDate,
                                        amount: 0,
                                        count: 0
                                    };
                                }

                                filteredDayWise[dueDate].amount += netAmount;
                                filteredDayWise[dueDate].count += 1;
                            }
                        }
                    }
                });

                // 2. Update the Total Due Amount
                const totalDueElement = document.getElementById('total-due-amount');
                if (totalDueElement) {
                    totalDueElement.textContent = `₹${filteredTotal.toFixed(2)}`;
                }

                // 3. Update the Day-wise Due cards
                const dayWiseContainer = document.getElementById('daywise-due-container');
                if (dayWiseContainer) {
                    // If filter is empty, don't update the cards (let enhancePurchaseTables handle it)
                    if (filterValue === '') {
                        // Force refresh via enhancePurchaseTables
                        enhancePurchaseTables();
                    } else {
                        // Otherwise, update the cards with filtered data
                        const filteredDays = Object.values(filteredDayWise).sort((a, b) =>
                            new Date(a.date) - new Date(b.date)
                        );

                        dayWiseContainer.innerHTML = filteredDays.map((item) => `
                        <div class="flex-shrink-0 min-w-[140px] bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer due-date-card" 
                             data-due-date="${item.date}">
                            <p class="text-xs font-medium text-gray-600 mb-1">${new Date(item.date).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric'
                        })
                            }</p>
                            <p class="text-lg font-bold text-gray-800">₹${item.amount.toFixed(2)}</p>
                            <p class="text-xs text-gray-500">${item.count} bill${item.count > 1 ? 's' : ''}</p>
                        </div>
                    `).join('') || '<p class="text-gray-500 text-sm">No pending dues</p>';

                        // Re-add click events to the new cards
                        setTimeout(() => {
                            document.querySelectorAll('.due-date-card').forEach(card => {
                                card.addEventListener('click', function () {
                                    const selectedDate = this.dataset.dueDate;

                                    // Remove active state from all cards
                                    document.querySelectorAll('.due-date-card').forEach(c => {
                                        c.classList.remove('bg-red-50', 'border-red-400');
                                        c.classList.add('bg-white', 'border-gray-200');
                                    });

                                    // Add active state to clicked card
                                    this.classList.remove('bg-white', 'border-gray-200');
                                    this.classList.add('bg-red-50', 'border-red-400');

                                    // Filter table to show only entries with this due date
                                    filterPurchaseManagementTable(selectedDate);
                                });
                            });
                        }, 100);
                    }
                }
            }
        });
    }

    if (document.getElementById('ugrai-received-amount')) {
        document.getElementById('ugrai-received-amount').addEventListener('input', function (e) {
            const netAmount = document.getElementById('ugrai-modal-net-amount').value;

            if (parseFloat(e.target.value) > parseFloat(netAmount)) {
                e.target.setCustomValidity('Amount received cannot be greater than net amount');
                e.target.reportValidity();
            } else {
                e.target.setCustomValidity('');
            }
        });
    }

    if (document.getElementById('ugrai-photo-upload')) {
        document.getElementById('ugrai-photo-upload').addEventListener('change', function (e) {
            const errorElement = document.getElementById('ugrai-photo-error');

            // Clear previous error messages
            if (errorElement) {
                errorElement.textContent = '';
                errorElement.style.display = 'none';
            }

            if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];

                // Validate the selected photo immediately
                const validation = validateUgraiPhoto();

                if (!validation.isValid) {
                    // Show validation error
                    if (errorElement) {
                        errorElement.textContent = validation.message;
                        errorElement.style.display = 'block';
                    }

                    // Clear the file input and hide preview
                    e.target.value = '';
                    const photoPreview = document.getElementById('ugrai-photo-preview');
                    if (photoPreview) {
                        photoPreview.classList.add('hidden');
                    }
                    return;
                }

                // File is valid, show preview
                const reader = new FileReader();
                reader.onload = function (e) {
                    const photoPreview = document.getElementById('ugrai-photo-preview');
                    if (photoPreview) {
                        const uploadedPhoto = document.getElementById('ugrai-uploaded-photo');
                        if (uploadedPhoto) {
                            uploadedPhoto.src = e.target.result;
                        }
                        photoPreview.classList.remove('hidden');
                    }
                };
                reader.readAsDataURL(file);
            }
        });
    }
    // Direct event listeners for purchase buttons
    document.addEventListener('click', function (e) {
        if (e.target.closest('.edit-purchase-btn')) {
            console.log("Edit button clicked");
            const entryId = e.target.closest('.edit-purchase-btn').dataset.entryId;
            console.log("Entry ID for edit:", entryId);
            editPurchaseEntry(entryId);
        } else if (e.target.closest('.confirm-purchase-btn')) {
            console.log("Confirm button clicked");
            const entryId = e.target.closest('.confirm-purchase-btn').dataset.entryId;
            console.log("Entry ID for confirm:", entryId);
            confirmPurchaseEntry(entryId);
        }
    });

    // Add event listeners for purchase management actions
    document.addEventListener('click', function (e) {
        if (e.target.closest('.account-entry-done-btn')) {
            const entryId = e.target.closest('.account-entry-done-btn').dataset.entryId;
            completeAccountEntryProcess(entryId);
        } else if (e.target.closest('.payment-done-btn')) {
            const entryId = e.target.closest('.payment-done-btn').dataset.entryId;
            markPaymentDone(entryId);
        } else if (e.target.closest('.view-details-btn')) {
            const retailer = e.target.closest('.view-details-btn').dataset.retailer;
            viewPurchaseDetails(retailer);
        }
    });
    // Ensure event listeners for purchase management actions are setup
    document.addEventListener('click', function (e) {
        if (e.target.closest('.payment-done-btn')) {
            console.log("Payment Done button clicked");
            const entryId = e.target.closest('.payment-done-btn').dataset.entryId;
            console.log("Entry ID for payment:", entryId);
            markPaymentDone(entryId);
        }
        // Make sure other action buttons are working too
        else if (e.target.closest('.account-entry-done-btn')) {
            console.log("Account Entry Done button clicked");
            const entryId = e.target.closest('.account-entry-done-btn').dataset.entryId;
            console.log("Entry ID for account entry:", entryId);
            completeAccountEntryProcess(entryId);
        }
    });
}

// Validation helper functions
function showValidationError(errorId, message) {
    const errorElement = document.getElementById(errorId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
    }
    // Also show the validation messages container
    const validationContainer = document.getElementById('validation-messages');
    if (validationContainer) {
        validationContainer.classList.remove('hidden');
    }
}

function hideAllValidationMessages() {
    const errorIds = ['status-error', 'method-error', 'amount-error', 'receipt-error', 'cheque-error', 'photo-error'];
    errorIds.forEach(errorId => {
        const errorElement = document.getElementById(errorId);
        if (errorElement) {
            errorElement.classList.add('hidden');
        }
    });
    // Hide the validation messages container
    const validationContainer = document.getElementById('validation-messages');
    if (validationContainer) {
        validationContainer.classList.add('hidden');
    }
}

// Function to open the supply done modal and populate with data
function openSupplyDoneModal(bill, isEdit = false) {
    console.log("Opening modal for bill:", bill, "Edit mode:", isEdit);

    // FIRST: Reset ALL form fields and containers to default state
    // This prevents state from previous modal openings from persisting
    document.getElementById('supply-status').value = '';
    document.getElementById('delivery-method').value = '';
    document.getElementById('receipt-number').value = '';
    document.getElementById('received-amount').value = '';
    document.getElementById('cheque-date').value = '';
    document.getElementById('edited-amount').value = '';

    // Hide ALL conditional containers initially
    document.getElementById('delivery-method-container').classList.add('hidden');
    document.getElementById('edited-amount-container').classList.add('hidden');
    document.getElementById('delivery-fields').classList.add('hidden');

    // Clear all photo-related elements
    const photoPreview = document.getElementById('photo-preview');
    const photoUpload = document.getElementById('photo-upload');
    const uploadedPhoto = document.getElementById('uploaded-photo');

    if (photoPreview) photoPreview.classList.add('hidden');
    if (photoUpload) photoUpload.value = '';
    if (uploadedPhoto) uploadedPhoto.src = '';

    // Reset button text to default
    const confirmBtn = document.getElementById('confirm-supply-btn');
    if (confirmBtn) {
        confirmBtn.textContent = 'Confirm';
    }

    // Hide validation messages
    hideAllValidationMessages();

    // NOW populate the modal with bill details
    document.getElementById('modal-bill-number').textContent = bill.billNumber;
    document.getElementById('modal-bill-retailer').textContent = bill.retailerName;
    document.getElementById('modal-bill-amount').textContent = `₹${parseFloat(bill.netAmount).toFixed(2)}`;

    // Set the correct max amounts based on THIS bill's net amount
    document.getElementById('max-amount-display').textContent = parseFloat(bill.netAmount).toFixed(2);
    document.getElementById('max-received-display').textContent = parseFloat(bill.netAmount).toFixed(2);

    // Set the hidden input with bill number
    document.getElementById('modal-bill-id').value = bill.billNumber;
    // Now handle the specific logic based on mode and status
    if (isEdit && (bill.status === 'Delivered' || bill.status === 'Cancelled' || bill.status === 'Edited')) {
        // EDIT MODE - Pre-fill form with existing data
        // Set status and let the change event handle field visibility
        const statusSelect = document.getElementById('supply-status');
        statusSelect.value = bill.status || '';

        // Fill in the form data based on bill status
        if (bill.status === 'Delivered') {
            // For delivered bills, populate delivery-related fields
            document.getElementById('delivery-method').value = bill.deliveryMethod || '';
            document.getElementById('receipt-number').value = bill.receiptNumber || '';
            document.getElementById('received-amount').value = bill.receivedAmount || bill.netAmount;
            document.getElementById('cheque-date').value = bill.chequeDate || '';

            // Load and show existing photos from storage
            loadExistingPhotosForEdit('supply', bill.billNumber);
        } else if (bill.status === 'Edited') {
            // For edited bills, populate edited amount
            document.getElementById('edited-amount').value = bill.editedAmount || '';
        }
        // For cancelled bills, no additional data to populate

        // Manually trigger the status change event to ensure proper field visibility
        statusSelect.dispatchEvent(new Event('change'));

        // Change button text to "Save" for edit mode
        if (confirmBtn) {
            confirmBtn.textContent = 'Save';
        }
    } else {
        // NEW ENTRY MODE - From Supplies in Progress
        document.getElementById('received-amount').value = bill.netAmount;
        // All other fields and containers remain in their reset state (hidden)
    }

    // Show the modal
    showModal('supply-done-modal');
}

// Function to load edited bills
function loadEditedBills() {
    const editedBillsTable = document.getElementById('edited-bills-table');
    if (!editedBillsTable) {
        console.error('Edited bills table element not found');
        return;
    }

    const editedBills = appState.data.editedBills || [];
    console.log('Loading edited bills:', editedBills);
    console.log('Number of edited bills:', editedBills.length);

    editedBillsTable.innerHTML = editedBills.map(bill => {
        // Handle different bill date field names and formats
        const billDate = bill.billDate || bill.bill_date || 'N/A';
        const formattedDate = billDate !== 'N/A' ?
            (typeof billDate === 'string' ? billDate : new Date(billDate).toISOString().split('T')[0]) : 'N/A';

        console.log('Creating row for bill:', bill.billNumber, 'with ID:', bill.id);
        return `
            <tr class="table-row">
                <td data-label="Bill Number">${bill.billNumber || 'N/A'}</td>
                <td data-label="Bill Date">${formattedDate}</td>
                <td data-label="Retailer Name">${bill.retailerName || 'N/A'}</td>
                <td data-label="Sector">${bill.sector || 'N/A'}</td>
                <td data-label="Net Amount">₹${parseFloat(bill.originalAmount || bill.netAmount || 0).toFixed(2)}</td>
                <td data-label="New Net Amount">
                    <input type="number" step="0.01" class="edited-net-amount compact-input w-full bg-gray-100 rounded border border-gray-300 focus:outline-none focus:border-red-600" 
                        data-bill-id="${bill.id}" value="${bill.editedAmount || bill.netAmount || ''}" placeholder="Enter new amount">
                </td>
                <td data-label="Action">
                    <button class="add-edited-to-staging-btn px-3 py-1 btn-red text-white rounded-lg hover:bg-red-700 transition-colors duration-300 text-xs" 
                        data-bill-id="${bill.id}" onclick="console.log('Button clicked for bill ID:', '${bill.id}')">Add to Staging</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Function to add edited bill to staging
async function addEditedBillToStaging(billId, editedAmount) {
    console.log('Looking for edited bill with ID:', billId, 'Type:', typeof billId);
    console.log('Available edited bills:', appState.data.editedBills);
    console.log('Available edited bill IDs:', appState.data.editedBills.map(b => ({ id: b.id, type: typeof b.id })));

    // Try both string and number comparison to handle type mismatches
    let bill = appState.data.editedBills.find(b => b.id == billId || b.id === String(billId) || b.id === Number(billId));

    if (!bill) {
        console.error('Bill not found in edited bills array. Searching by bill number as fallback...');
        // Try to find by bill number as fallback
        const billByNumber = appState.data.editedBills.find(b => b.billNumber === billId || b.billNumber === String(billId));
        if (billByNumber) {
            console.log('Found bill by bill number:', billByNumber);
            bill = billByNumber;
        } else {
            console.error('All search methods failed. Bill IDs and types:',
                appState.data.editedBills.map(b => `ID: ${b.id} (${typeof b.id}), Bill#: ${b.billNumber} (${typeof b.billNumber})`));
            showToast(`Bill not found. ID searched: ${billId} (${typeof billId})`, 'error');
            return;
        }
    }

    console.log('Found bill:', bill);

    if (!editedAmount || parseFloat(editedAmount) <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    try {
        // First, update the edited_amount in the database to persist the change
        if (appState.supabaseService && typeof appState.supabaseService.updateEditedBillAmount === 'function') {
            try {
                await appState.supabaseService.updateEditedBillAmount(billId, editedAmount);
                console.log('✅ Updated edited_amount in database before staging');
            } catch (updateError) {
                console.error('⚠️ Failed to update edited_amount in database:', updateError);
                // Continue with staging even if update fails, as it's not critical
            }
        }

        // Create the bill for staging with updated amount and proper formatting
        const billForStaging = {
            billNumber: bill.billNumber || bill.bill_number || 'Unknown',
            billDate: bill.billDate || bill.bill_date || new Date().toISOString().split('T')[0],
            retailerName: bill.retailerName || bill.retailer_name || 'Unknown',
            netAmount: parseFloat(editedAmount),
            brand: bill.brand || 'Unknown',
            sector: bill.sector || 'Unknown',
            editedFromAmount: bill.originalAmount || bill.netAmount || 0, // Track original amount
            isEdited: true
        };

        console.log('Adding edited bill to staging area:', billForStaging);
        console.log('Original bill data:', bill);

        // Check if bill already exists in staging first
        if (appState.supabaseService && typeof appState.supabaseService.checkBillExistsInStaging === 'function') {
            const existingBill = await appState.supabaseService.checkBillExistsInStaging(billForStaging.billNumber);
            if (existingBill) {
                console.log('📋 Bill already exists in staging, will update it:', existingBill);
            }
        }

        // Add to staging area (temporary bills) instead of active supplies
        await appState.addTemporaryBill(billForStaging);

        // Only remove from edited bills if staging was successful
        console.log('🔄 About to remove edited bill with ID:', billId, 'Type:', typeof billId);
        try {
            await appState.removeEditedBill(billId);
            console.log('✅ Successfully removed edited bill from AppState');
        } catch (removeError) {
            console.error('❌ Error removing edited bill:', removeError);
            throw removeError; // Re-throw to prevent success message
        }

        showToast(`Edited bill added to staging! Amount changed from ₹${bill.originalAmount || bill.netAmount} to ₹${editedAmount}`, 'success', 5000);

        // Reload edited bills and staging area to reflect changes in real-time
        console.log('🔄 Reloading edited bills display...');
        loadEditedBills();

        // Also refresh staging area to show the newly added bill
        console.log('🔄 Refreshing staging area...');
        if (appState.loadBills && typeof appState.loadBills === 'function') {
            await appState.loadBills();
        }
    } catch (error) {
        console.error('Error adding edited bill to staging:', error);

        // Provide specific error message for duplicate bills
        if (error.message && error.message.includes('duplicate key')) {
            showToast('Bill already exists in staging area. Please check Upload Supply Data section.', 'warning', 5000);
            // Still remove from edited bills since it's already in staging
            try {
                await appState.removeEditedBill(billId);
                loadEditedBills();
                // Refresh staging area to ensure duplicate is visible
                if (appState.loadBills && typeof appState.loadBills === 'function') {
                    await appState.loadBills();
                }
            } catch (removeError) {
                console.error('Error removing edited bill after duplicate:', removeError);
            }
        } else {
            showToast('Error adding bill to staging: ' + (error.message || error), 'error');
        }
        console.error('Error adding edited bill to staging:', error);
        showToast('Error adding bill to staging', 'error');
    }
}

// Function to update fields based on delivery method
function updateDeliveryFields(method) {
    const receiptNumberContainer = document.getElementById('receipt-number-container');
    const chequeDateContainer = document.getElementById('cheque-date-container');
    const receivedAmountContainer = document.getElementById('received-amount-container');
    const photoUploadContainer = document.getElementById('photo-upload-container');
    const photoPreview = document.getElementById('photo-preview'); // Add this line

    // Hide all fields first
    receiptNumberContainer.classList.add('hidden');
    chequeDateContainer.classList.add('hidden');
    receivedAmountContainer.classList.add('hidden');
    photoUploadContainer.classList.add('hidden');

    // IMPORTANT: Don't show photo preview when updating delivery fields from new entries
    const isEditMode = document.getElementById('confirm-supply-btn').textContent === 'Save';
    if (!isEditMode && photoPreview) {
        photoPreview.classList.add('hidden');
    }

    // Show/hide fields based on delivery method
    if (method === 'Credit') {
        // Photo is now required for Credit as well
        photoUploadContainer.classList.remove('hidden');
    } else if (method === 'Cash' || method === 'UPI' || method === 'Cheque') {
        receiptNumberContainer.classList.remove('hidden');
        receivedAmountContainer.classList.remove('hidden');
        photoUploadContainer.classList.remove('hidden');
    }
    if (method === 'Cheque') {
        chequeDateContainer.classList.remove('hidden');
    }
}
// Enhanced photo validation function for Ugrai completion
function validateUgraiPhotoRequirement(paymentMethod, isEditMode) {
    console.log('📸 Validating photo requirement for payment method:', paymentMethod, 'Edit mode:', isEditMode);

    // Define which payment methods require photos
    const paymentMethodsRequiringPhoto = ['Cash', 'UPI', 'Cheque'];
    const requiresPhoto = paymentMethodsRequiringPhoto.includes(paymentMethod);

    console.log('  - Photo required:', requiresPhoto);

    if (!requiresPhoto) {
        console.log('  ✅ No photo required for payment method:', paymentMethod);
        return { isValid: true };
    }

    // Get photo-related elements
    const photoUpload = document.getElementById('ugrai-photo-upload');
    const photoPreview = document.getElementById('ugrai-photo-preview');
    const uploadedPhoto = document.getElementById('ugrai-uploaded-photo');

    console.log('  - Photo upload element found:', !!photoUpload);
    console.log('  - Photo preview element found:', !!photoPreview);
    console.log('  - Uploaded photo element found:', !!uploadedPhoto);

    // Check if a new photo is being uploaded
    const hasNewPhotoUpload = photoUpload && photoUpload.files && photoUpload.files.length > 0;
    console.log('  - Has new photo upload:', hasNewPhotoUpload);

    // Check if there's an existing photo preview
    const hasExistingPhoto = photoPreview && !photoPreview.classList.contains('hidden') &&
        uploadedPhoto && uploadedPhoto.src &&
        !uploadedPhoto.src.includes('data:image/svg+xml'); // Not placeholder
    console.log('  - Has existing photo:', hasExistingPhoto);

    // Validation logic
    if (isEditMode) {
        // In edit mode, we need either a new upload OR an existing photo
        if (!hasNewPhotoUpload && !hasExistingPhoto) {
            console.log('  ❌ Edit mode: No new photo and no existing photo');
            return {
                isValid: false,
                errorMessage: `Photo is required for ${paymentMethod} payment. Please upload a photo or ensure existing photo is displayed.`
            };
        }
        console.log('  ✅ Edit mode: Photo requirement satisfied');
        return { isValid: true };
    } else {
        // In new entry mode, we must have a new upload
        if (!hasNewPhotoUpload) {
            console.log('  ❌ New entry mode: No photo uploaded');
            return {
                isValid: false,
                errorMessage: `Photo is required for ${paymentMethod} payment. Please upload a photo before proceeding.`
            };
        }

        // Additional validation: check file type and size
        const file = photoUpload.files[0];
        const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
        const maxSizeInMB = 5;
        const maxSizeInBytes = maxSizeInMB * 1024 * 1024;

        console.log('  - File type:', file.type);
        console.log('  - File size:', (file.size / (1024 * 1024)).toFixed(2), 'MB');

        if (!allowedTypes.includes(file.type)) {
            console.log('  ❌ Invalid file type');
            return {
                isValid: false,
                errorMessage: 'Please upload a valid image file (JPEG, PNG, or GIF).'
            };
        }

        if (file.size > maxSizeInBytes) {
            console.log('  ❌ File too large');
            return {
                isValid: false,
                errorMessage: `Image file is too large. Please upload an image smaller than ${maxSizeInMB}MB.`
            };
        }

        console.log('  ✅ New entry mode: Photo validation passed');
        return { isValid: true };
    }
}

// Function to open Ugrai Done modal
function openUgraiDoneModal(bill, isEdit = false) {
    console.log("Opening Ugrai modal for bill:", bill, "Edit mode:", isEdit);
    console.log("🔍 Bill assignedTo value:", bill.assignedTo);
    console.log("🔍 Bill assigned_to value:", bill.assigned_to);
    console.log("🔍 Bill dueAmount value:", bill.dueAmount);

    // Calculate due amount (use bill.dueAmount if available, otherwise calculate)
    const netAmount = parseFloat(bill.netAmount || bill.amount || 0);
    const receivedAmount = parseFloat(bill.receivedAmount || bill.received_amount || 0);
    const dueAmount = bill.dueAmount !== undefined ? parseFloat(bill.dueAmount) : (netAmount - receivedAmount);

    console.log("🔍 Calculated amounts - Net:", netAmount, "Received:", receivedAmount, "Due:", dueAmount);

    // Populate modal with bill details
    document.getElementById('ugrai-modal-bill-number').textContent = bill.billNumber || bill.id || 'N/A';
    document.getElementById('ugrai-modal-bill-retailer').textContent = bill.retailerName || 'N/A';
    document.getElementById('ugrai-modal-bill-amount').textContent = `₹${dueAmount.toFixed(2)}`;

    // Set assigned-to display with fallback to sector assignment
    let assignedToValue = bill.assignedTo || bill.assigned_to || '';

    // Fallback: if assignedTo is empty, look it up from sector assignments
    if (!assignedToValue && bill.sector) {
        const assignments = appState.data.ugraiAssignments || {};
        assignedToValue = assignments[bill.sector] || '';
        console.log(`🔍 Looked up assignedTo from sector "${bill.sector}":`, assignedToValue);
    }

    const assignedToDisplay = document.getElementById('ugrai-modal-assigned-to-display');
    if (assignedToDisplay) {
        assignedToDisplay.textContent = assignedToValue || 'N/A';
    }

    // Set hidden inputs
    document.getElementById('ugrai-modal-bill-id').value = bill.id || bill.billNumber;
    document.getElementById('ugrai-modal-bill-sector').value = bill.sector || '';
    document.getElementById('ugrai-modal-net-amount').value = netAmount;
    document.getElementById('ugrai-modal-assigned-to').value = assignedToValue;
    console.log("🔍 Set hidden assignedTo field to:", assignedToValue);

    // Set max amount to due amount
    document.getElementById('ugrai-max-received-display').textContent = dueAmount.toFixed(2);

    if (isEdit) {
        // In edit mode, populate fields with existing data
        document.getElementById('ugrai-payment-method').value = bill.paymentMethod || '';
        document.getElementById('ugrai-receipt-number').value = bill.receiptNumber || '';
        document.getElementById('ugrai-received-amount').value = bill.receivedAmount || bill.netAmount;
        document.getElementById('ugrai-cheque-date').value = bill.chequeDate || '';

        // Show fields based on payment method
        if (bill.paymentMethod) {
            updateUgraiPaymentFields(bill.paymentMethod);
        }

        // Load and show existing photos from storage
        loadExistingPhotosForUgraiEdit('ugrai', bill.billNumber || bill.id);

        // Set button text to "Save" in edit mode
        const confirmBtn = document.getElementById('confirm-ugrai-btn');
        if (confirmBtn) {
            confirmBtn.textContent = 'Save';
        }
    } else {
        // Reset form for new entry
        document.getElementById('ugrai-payment-method').value = '';
        document.getElementById('ugrai-receipt-number').value = '';
        document.getElementById('ugrai-received-amount').value = dueAmount.toFixed(2);
        document.getElementById('ugrai-cheque-date').value = '';

        // Hide all dynamic fields
        document.getElementById('ugrai-payment-fields').classList.add('hidden');
        document.getElementById('ugrai-photo-preview').classList.add('hidden');

        // Reset button text
        const confirmBtn = document.getElementById('confirm-ugrai-btn');
        if (confirmBtn) {
            confirmBtn.textContent = 'Confirm';
        }
    }

    // Hide validation messages
    hideUgraiValidationMessages();

    // Show modal
    showModal('ugrai-done-modal');

    // Extra guard: ensure modal is interactive and confirm button is enabled/focused
    try {
        const modalEl = document.getElementById('ugrai-done-modal');
        if (modalEl) {
            modalEl.classList.remove('pointer-events-none');
            modalEl.style.zIndex = '9999';
        }

        const confirmBtn = document.getElementById('confirm-ugrai-btn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            // focus to make it clear it's clickable
            setTimeout(() => { try { confirmBtn.focus(); } catch (e) { } }, 80);
        }
    } catch (err) {
        console.error('Error ensuring UGRAI modal interactivity:', err);
    }
}
// Function to open Purchase Entry modal
function openPurchaseEntryModal() {
    // Generate unique ID
    const uniqueId = appState.generatePurchaseUniqueId();
    document.getElementById('purchase-unique-id').value = uniqueId;

    // Populate retailer dropdown
    const retailerDropdown = document.getElementById('purchase-retailer-name');
    retailerDropdown.innerHTML = '<option value="">Select Retailer</option>' +
        appState.data.purchaseRetailers.map(r =>
            `<option value="${r.retailerName}">${r.retailerName}</option>`
        ).join('');

    // Reset form
    document.getElementById('purchase-entry-form').reset();
    document.getElementById('purchase-unique-id').value = uniqueId; // Keep unique ID
    document.getElementById('purchase-note-container').style.display = 'none';

    // Show modal
    showModal('purchase-entry-modal');
}

// Function to update Ugrai fields based on payment method
function updateUgraiPaymentFields(method) {
    const receiptContainer = document.getElementById('ugrai-receipt-container');
    const receivedAmountContainer = document.getElementById('ugrai-received-amount-container');
    const chequeDateContainer = document.getElementById('ugrai-cheque-date-container');
    const photoUploadContainer = document.getElementById('ugrai-photo-upload-container');

    // First hide all containers
    receiptContainer.classList.add('hidden');
    receivedAmountContainer.classList.add('hidden');
    chequeDateContainer.classList.add('hidden');
    photoUploadContainer.classList.add('hidden');

    // Show fields based on payment method
    if (method) {
        document.getElementById('ugrai-payment-fields').classList.remove('hidden');
    } else {
        document.getElementById('ugrai-payment-fields').classList.add('hidden');
        return;
    }

    // Always show received amount for all methods
    receivedAmountContainer.classList.remove('hidden');

    // Handle NEFT specially - only show received amount
    if (method === 'NEFT') {
        // For NEFT, only show received amount field
        // Don't show receipt number or photo upload
    } else if (method === 'Cash' || method === 'UPI' || method === 'Cheque') {
        receiptContainer.classList.remove('hidden');
        photoUploadContainer.classList.remove('hidden');

        // Check if photo is already uploaded and validate it
        const photoInput = document.getElementById('ugrai-photo-upload');
        if (photoInput && photoInput.files && photoInput.files.length > 0) {
            const validation = validateUgraiPhoto();
            if (!validation.isValid) {
                const errorElement = document.getElementById('ugrai-photo-error');
                if (errorElement) {
                    errorElement.textContent = validation.message;
                    errorElement.style.display = 'block';
                }
            }
        }
    }

    if (method === 'Cheque') {
        chequeDateContainer.classList.remove('hidden');
    }

    // Clear any previous photo errors when payment method changes (except for invalid photos)
    const paymentRequiresPhoto = (method === 'Cash' || method === 'UPI' || method === 'Cheque');
    if (!paymentRequiresPhoto) {
        hideUgraiValidationMessages();
    } else {
        // Only clear non-photo errors for photo-required methods
        const errorIds = [
            'ugrai-payment-error',
            'ugrai-receipt-error',
            'ugrai-amount-error',
            'ugrai-cheque-error'
        ];
        errorIds.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = '';
                element.style.display = 'none';
            }
        });
    }
}

// Function to hide Ugrai validation messages
function hideUgraiValidationMessages() {
    const errorIds = [
        'ugrai-payment-error',
        'ugrai-receipt-error',
        'ugrai-amount-error',
        'ugrai-cheque-error',
        'ugrai-photo-error'
    ];

    errorIds.forEach(errorId => {
        const errorElement = document.getElementById(errorId);
        if (errorElement) {
            errorElement.classList.add('hidden');
        }
    });

    const validationContainer = document.getElementById('ugrai-validation-messages');
    if (validationContainer) {
        validationContainer.classList.add('hidden');
    }
}

// Enhanced photo validation function
function validateUgraiPhoto(paymentMethod) {
    // Get payment method from form if not provided
    if (!paymentMethod) {
        const paymentSelect = document.getElementById('ugrai-payment-method');
        paymentMethod = paymentSelect ? paymentSelect.value : '';
    }

    console.log(`🔍 Starting photo validation for ${paymentMethod}`);

    // Check for existing photo (in edit mode)
    const photoPreview = document.getElementById('ugrai-photo-preview');
    const hasExistingPhoto = photoPreview && !photoPreview.classList.contains('hidden');
    const isEditMode = hasExistingPhoto;

    // Get photo input element
    const photoInput = document.getElementById('ugrai-photo-upload');

    console.log(`🔍 Using enhanced validation for ${paymentMethod}, Edit mode: ${isEditMode}`);

    // Use the comprehensive validation function
    return validateUgraiPhotoRequirement(paymentMethod, photoInput, isEditMode);
}

// Function to show Ugrai validation error
function showUgraiValidationError(errorId, message) {
    const errorElement = document.getElementById(errorId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.classList.remove('hidden');
    }

    // Show validation messages container
    const validationContainer = document.getElementById('ugrai-validation-messages');
    if (validationContainer) {
        validationContainer.classList.remove('hidden');
    }
}

function renderMainContent(processName) {
    console.log("Rendering main content for process:", processName);

    const purchaseDashboardContainer = document.getElementById('purchase-dashboard-container');

    if (!supplyDashboardContainer || !ugraiDashboardContainer) {
        console.error("Dashboard containers not found");
        return;
    }

    // Hide all dashboards first
    supplyDashboardContainer.classList.add('hidden');
    ugraiDashboardContainer.classList.add('hidden');
    if (purchaseDashboardContainer) {
        purchaseDashboardContainer.classList.add('hidden');
    }
    if (analysisDashboardContainer) {
        analysisDashboardContainer.classList.add('hidden');
    }
    if (cashReceiptDashboardContainer) {
        cashReceiptDashboardContainer.classList.add('hidden');
    }

    // Update active tab in main processes
    document.querySelectorAll('#main-processes button').forEach(button => {
        if (button.dataset.process === processName) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });

    // Show the selected dashboard and render sub-processes
    if (processName === 'supply') {
        supplyDashboardContainer.classList.remove('hidden');
        renderSubProcesses('supply');
    } else if (processName === 'ugrai') {
        ugraiDashboardContainer.classList.remove('hidden');
        renderSubProcesses('ugrai');
    } else if (processName === 'purchase') {
        const purchaseDashboardContainer = document.getElementById('purchase-dashboard-container');
        if (purchaseDashboardContainer) {
            purchaseDashboardContainer.classList.remove('hidden');
        }
        renderSubProcesses('purchase');
    } else if (processName === 'analysis') {
        if (analysisDashboardContainer) {
            analysisDashboardContainer.classList.remove('hidden');
        }
        renderSubProcesses('analysis');
    } else if (processName === 'cash-receipt') {
        if (cashReceiptDashboardContainer) {
            cashReceiptDashboardContainer.classList.remove('hidden');
            console.log('✅ Cash receipt dashboard container shown (hidden class removed)');
            console.log('Container classes:', cashReceiptDashboardContainer.className);
        } else {
            console.error('❌ Cash receipt dashboard container not found!');
        }
        renderSubProcesses('cash-receipt');
    }

}

function renderSubProcesses(processName) {
    console.log("Rendering sub-processes for:", processName);

    if (subProcessesContainer) {
        subProcessesContainer.style.display = 'flex';

        if (processName === 'supply' || processName === 'ugrai' || processName === 'purchase' || processName === 'analysis' || processName === 'cash-receipt') {
            console.log("Creating tabs for:", PROCESS_MAP[processName]);

            // Permission mapping for sub-processes
            const permissionMap = {
                'supply': {
                    'Base File Management': 'supply.base_file.view',
                    'Base file management': 'supply.base_file.view',
                    'Upload Supply Data': 'supply.upload.view',
                    'Bills to Dispatch': 'supply.dispatch.view',
                    'Supplies in Progress': 'supply.in_progress.view',
                    'Supply Management': 'supply.management.view'
                },
                'ugrai': {
                    'Ugrai Base File': 'ugrai.base_file.view',
                    'Total Ugrai': 'ugrai.total.view',
                    'Ugrai Issue': 'ugrai.issue.view',
                    'Ugrai in Progress': 'ugrai.in_progress.view',
                    'Ugrai Management': 'ugrai.management.view'
                },
                'purchase': {
                    'Purchase Base File': 'purchase.base_file.view',
                    'Purchase Entry': 'purchase.entry.view',
                    'Accounting': 'purchase.accounting.view',
                    'Purchase Management': 'purchase.management.view',
                    'Purchased': 'purchase.purchased.view'
                },
                'analysis': {
                    'Supply Analysis': 'analysis.supply.view',
                    'Ugrai Analysis': 'analysis.ugrai.view',
                    'Purchase Analysis': 'analysis.purchase.view',
                    'Pending Bills': 'analysis.pending_bills.view'
                },
                'cash-receipt': {
                    'Cash Receipt': 'cash_receipt.view'
                }
            };

            // Filter sub-processes based on permissions
            console.log(`🔍 Filtering ${processName} sub-processes...`);
            console.log(`Available sub-processes:`, PROCESS_MAP[processName]);
            console.log(`Permission map for ${processName}:`, permissionMap[processName]);

            const allowedSubProcesses = PROCESS_MAP[processName].filter(name => {
                if (name && name.toLowerCase().includes('base file')) {
                    return true; // Always show Base File Management
                }
                const requiredPermission = permissionMap[processName]?.[name];
                console.log(`Checking sub-process: ${name}, required permission: ${requiredPermission}`);

                if (!requiredPermission) {
                    console.log(`No permission required for ${name}, showing by default`);
                    return true; // Show if no permission mapping exists
                }

                // Check permission if RBAC service is available
                if (window.rbacService) {
                    const hasPermission = window.rbacService.hasPermission(requiredPermission);
                    console.log(`Permission check for ${requiredPermission}: ${hasPermission}`);

                    if (!hasPermission) {
                        console.log(`❌ Hiding tab: ${name} (no ${requiredPermission} permission)`);
                    } else {
                        console.log(`✅ Keeping tab: ${name} (has ${requiredPermission} permission)`);
                    }
                    return hasPermission;
                }

                console.log(`RBAC not available yet, showing ${name} by default`);
                return true; // Show by default if RBAC not initialized yet
            });

            console.log(`Filtered sub-processes for ${processName}:`, allowedSubProcesses);

            const subProcessesHTML = allowedSubProcesses.map(name => {
                const tabId = name.toLowerCase().replace(/\s+/g, '-');
                return `<button class="sub-heading" data-tab-id="${tabId}">${name}</button>`;
            }).join('');

            subProcessesContainer.innerHTML = subProcessesHTML;

            // Add click event handlers to each tab
            document.querySelectorAll('.sub-heading').forEach(button => {
                button.addEventListener('click', function () {
                    const tabId = this.dataset.tabId;
                    console.log(`🖱️ Tab clicked: ${tabId}`);

                    // Check if user has permission for this section
                    const sectionPermissions = {
                        // Supply permissions
                        'base-file-management': 'supply.base_file.view',
                        'upload-supply-data': 'supply.upload.view',
                        'bills-to-dispatch': 'supply.dispatch.view',
                        'supplies-in-progress': 'supply.in_progress.view',
                        'supply-management': 'supply.management.view',
                        // UGRAI permissions
                        'ugrai-base-file': 'ugrai.base_file.view',
                        'total-ugrai': 'ugrai.total.view',
                        'ugrai-issue': 'ugrai.issue.view',
                        'ugrai-in-progress': 'ugrai.in_progress.view',
                        'ugrai-management': 'ugrai.management.view',
                        // Purchase permissions
                        'purchase-base-file': 'purchase.base_file.view',
                        'purchase-entry': 'purchase.entry.view',
                        'accounting': 'purchase.accounting.view',
                        'purchase-management': 'purchase.management.view',
                        'purchased': 'purchase.purchased.view',
                        // Analysis permissions
                        'supply-analysis': 'analysis.supply.view',
                        'payment-received-analysis': 'analysis.ugrai.view',
                        'purchase-analysis': 'analysis.purchase.view',
                        'pending-bills': 'analysis.pending_bills.view',
                        // Cash Receipt permissions
                        'cash-receipt': 'cash_receipt.view'
                    };

                    const requiredPermission = sectionPermissions[tabId];
                    if (tabId === 'base-file-management') {
                        // Base File Management is always accessible
                    } else if (requiredPermission && window.rbacService && !window.rbacService.hasPermission(requiredPermission)) {
                        console.log(`❌ Access denied to ${tabId} - missing ${requiredPermission} permission`);
                        alert(`Access Denied: You don't have permission to view this section.`);
                        return; // Don't proceed with tab switching
                    }

                    // Hide all content sections
                    document.querySelectorAll('[data-tab-content]').forEach(section => {
                        section.style.display = 'none';
                    });

                    // Show the selected content section only if user has permission
                    const selectedContent = document.querySelector(`[data-tab-content="${tabId}"]`);
                    if (selectedContent) {
                        selectedContent.style.display = 'block';
                        console.log(`✅ Showing section: ${tabId}`);

                        // Direct auto-load for Base File Management without clicking View
                        if (tabId === 'base-file-management') {
                            const tableContainer = document.getElementById('retailer-data-table-container');
                            if (tableContainer) {
                                tableContainer.classList.remove('hidden');
                                tableContainer.style.display = 'block';
                            }
                            if (window.appState) {
                                console.log('📥 Auto-loading fresh retailers data from DB...');
                                window.appState.loadRetailers();
                            }
                        }

                        // Special handling for cash-receipt to ensure full visibility
                        if (tabId === 'cash-receipt') {
                            const cashReceiptContent = document.getElementById('cash-receipt-content');
                            if (cashReceiptContent) {
                                cashReceiptContent.style.opacity = '1';
                                cashReceiptContent.style.pointerEvents = 'auto';
                                console.log('✅ Cash receipt content visibility forced');
                            }

                            // If no data loaded yet, trigger load
                            if (typeof cashReceiptState !== 'undefined' &&
                                cashReceiptState.allPayments.length === 0 &&
                                typeof isLoadingPayments !== 'undefined' &&
                                !isLoadingPayments) {
                                console.log('📥 Tab clicked but no data - triggering load...');
                                if (typeof loadCashPayments === 'function') {
                                    loadCashPayments().catch(err => {
                                        console.error('❌ Failed to load from tab click:', err);
                                    });
                                }
                            } else if (typeof cashReceiptState !== 'undefined' && cashReceiptState.allPayments.length > 0) {
                                console.log('🔄 Tab clicked with data - forcing re-render...');
                                if (typeof renderCashReceiptsTable === 'function') {
                                    renderCashReceiptsTable();
                                }
                            }
                        }
                    }

                    // Update active tab state
                    document.querySelectorAll('.sub-heading').forEach(btn => {
                        btn.classList.remove('active');
                    });
                    this.classList.add('active');
                });
            });

            // Click the first tab automatically
            const firstSubProcessTab = subProcessesContainer.querySelector('.sub-heading');
            if (firstSubProcessTab) {
                console.log("Clicking first tab:", firstSubProcessTab.textContent);
                firstSubProcessTab.click();

                // FIXED: If in UGRAI mode, populate all tabs immediately
                if (processName === 'ugrai') {
                    populateAllUgraiTabs(); // This will create all the tab content
                }

                // For Purchase mode, ensure first tab content is visible
                if (processName === 'purchase') {
                    const purchaseBaseFile = document.querySelector('[data-tab-content="purchase-base-file"]');
                    if (purchaseBaseFile) {
                        purchaseBaseFile.style.display = 'block';
                    }
                }
            }
        } else {
            subProcessesContainer.innerHTML = '';
            subProcessesContainer.style.display = 'none';
        }
    }
}


function toggleTheme() {
    const currentTheme = document.documentElement.className;
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.className = newTheme;
    localStorage.setItem('theme', newTheme);
    updateToggleBallPosition(newTheme);
}

function updateToggleBallPosition(theme) {
    if (themeToggle) {
        const toggleBall = themeToggle.querySelector('.toggle-ball');
        if (toggleBall) {
            if (theme === 'dark') {
                toggleBall.style.transform = 'translateX(25px)';
            } else {
                toggleBall.style.transform = 'translateX(0)';
            }
        }
    }
    // Also update navigation toggle
    updateNavToggleBallPosition(theme);
}

function updateNavToggleBallPosition(theme) {
    const navThemeToggle = document.getElementById('nav-theme-toggle');
    if (navThemeToggle) {
        const toggleBall = navThemeToggle.querySelector('.toggle-ball');
        if (toggleBall) {
            if (theme === 'dark') {
                toggleBall.style.transform = 'translateX(22px)'; // Slightly smaller for nav menu
            } else {
                toggleBall.style.transform = 'translateX(0)';
            }
        }
    }
}

class AppState {
    constructor() {
        this.data = {
            temporaryBills: [],
            bills: [],
            activeSupplies: [],
            approvedBills: [],
            retailers: [],
            editedBills: [],
            theme: localStorage.getItem('theme') || 'light',
            // FIXED: Initialize Ugrai data structures in constructor
            ugraiData: [],
            ugraiEntries: [],
            ugraiAssignments: {},
            persons: ['Mohan', 'Suresh', 'Rahul'],
            completedUgrai: [],
            // Purchase data
            purchaseRetailers: [],
            purchaseEntries: []
        };
        this.collections = {};
        this.reportFilter = {
            date: '',
            method: 'all'
        };
    }

    async replaceUgraiData(ugraiItems) {
        try {
            if (mockMode) {
                this.data.ugraiData = ugraiItems;
                renderDashboard();
                return;
            }

            // Supabase mode
            await this.supabaseService.replaceUgraiData(ugraiItems);
            this.data.ugraiData = ugraiItems;
            renderDashboard();

            console.log('✅ UGRAI data replaced successfully');
        } catch (error) {
            console.error('❌ Error replacing UGRAI data:', error);
            throw error;
        }
    }

    async addUgraiEntry(creditBill) {
        try {
            const ugraiEntry = {
                id: `UG-${creditBill.billNumber}`,
                billNumber: creditBill.billNumber,
                billDate: creditBill.billDate,
                retailerName: creditBill.retailerName,
                sector: creditBill.sector,
                netAmount: creditBill.netAmount,
                status: 'Pending',
                assignedTo: null,
                originalSupplyId: creditBill.id
            };

            if (mockMode) {
                this.data.ugraiEntries.push(ugraiEntry);
                renderDashboard();
                return ugraiEntry;
            }

            // Supabase mode
            const result = await this.supabaseService.addUgraiEntry(ugraiEntry);
            this.data.ugraiEntries.push({ ...ugraiEntry, id: result.id });
            renderDashboard();

            return result;
        } catch (error) {
            console.error('❌ Error adding UGRAI entry:', error);
            throw error;
        }
    }

    async saveUgraiAssignments(assignments) {
        try {
            if (mockMode) {
                this.data.ugraiAssignments = assignments;
                renderDashboard();
                return;
            }

            // Supabase mode
            await this.supabaseService.saveUgraiAssignments(assignments);
            this.data.ugraiAssignments = assignments;
            renderDashboard();

            console.log('✅ UGRAI assignments saved successfully');
        } catch (error) {
            console.error('❌ Error saving UGRAI assignments:', error);
            throw error;
        }
    }

    // Add method to complete Ugrai bill
    async completeUgraiBill(billId, updates) {
        console.log(`🔍 Starting completeUgraiBill for ID: "${billId}"`, typeof billId);
        console.log(`🔍 Updates:`, updates);

        try {
            console.log('🔍 completeUgraiBill called with billId:', billId, 'type:', typeof billId);

            // OPTIMIZATION: Skip ensureDataConsistency to make completion faster
            // The backend SQL functions handle data consistency automatically
            // await this.ensureDataConsistency();

            // Use the comprehensive search function
            let searchResult = this.findBillAcrossAllSources(billId);
            let bill = searchResult.bill;
            let billIndex = searchResult.index;
            let sourceArray = searchResult.sourceArray;

            // Check if bill is already completed
            if (searchResult.alreadyCompleted) {
                const completedBill = searchResult.completedBill;
                showToast(`Bill ${completedBill.billNumber || billId} was already completed on ${completedBill.dateCompleted || 'unknown date'}`, 'info');
                console.log('ℹ️ Attempted to complete already completed bill:', completedBill);
                return true; // Return true since it's technically "complete"
            }

            if (!bill || !sourceArray) {
                console.error(`🔍 completeUgraiBill: Ugrai bill ${billId} not found on first attempt`);
                console.log('🔍 Available data sources:');
                console.log('  - ugraiData:', this.data.ugraiData?.length || 0, 'items');
                console.log('  - ugraiEntries:', this.data.ugraiEntries?.length || 0, 'items');
                console.log('  - ugraiInProgress:', this.data.ugraiInProgress?.length || 0, 'items');
                console.log('  - approvedBills:', this.data.approvedBills?.length || 0, 'items');

                // Enhanced debugging for ID matching
                console.log('🔍 Searching for:', { value: billId, type: typeof billId, length: billId?.length });

                if (this.data.ugraiInProgress?.length > 0) {
                    console.log('🔍 ugraiInProgress sample IDs:');
                    const sampleIds = this.data.ugraiInProgress.slice(0, 5).map(b => ({
                        id: b.id,
                        idType: typeof b.id,
                        idLength: b.id?.length,
                        billNumber: b.billNumber,
                        billNumberType: typeof b.billNumber,
                        billNumberLength: b.billNumber?.length,
                        exactMatch: b.id === billId || b.billNumber === billId,
                        looseMatch: b.id == billId || b.billNumber == billId
                    }));
                    console.log(sampleIds);

                    // Check for any ID that contains our target ID
                    const containsMatch = this.data.ugraiInProgress.find(b =>
                        (b.id && b.id.toString().includes(billId)) ||
                        (b.billNumber && b.billNumber.toString().includes(billId))
                    );
                    if (containsMatch) {
                        console.log('🔍 Found containing match:', {
                            id: containsMatch.id,
                            billNumber: containsMatch.billNumber,
                            status: containsMatch.status
                        });
                    }
                }

                if (this.data.ugraiData?.length > 0) {
                    console.log('🔍 ugraiData sample IDs:');
                    const sampleIds = this.data.ugraiData.slice(0, 3).map(b => ({
                        id: b.id,
                        billNumber: b.billNumber,
                        exactMatch: b.id === billId || b.billNumber === billId
                    }));
                    console.log(sampleIds);
                }

                if (this.data.approvedBills?.length > 0) {
                    console.log('  - approvedBills sample:', this.data.approvedBills.slice(0, 2).map(b => ({
                        id: b.id,
                        billNumber: b.billNumber,
                        deliveryMethod: b.deliveryMethod,
                        exactMatch: b.id === billId || b.billNumber === billId
                    })));
                }

                // Try refreshing data from Supabase as fallback
                console.log('🔄 Attempting to refresh data from Supabase and retry...');
                try {
                    await this.loadUgraiData();

                    // Retry search after refresh using comprehensive search
                    searchResult = this.findBillAcrossAllSources(billId);
                    bill = searchResult.bill;
                    billIndex = searchResult.index;
                    sourceArray = searchResult.sourceArray;

                    // Check again for already completed bills after refresh
                    if (searchResult.alreadyCompleted) {
                        const completedBill = searchResult.completedBill;
                        showToast(`Bill ${completedBill.billNumber || billId} was already completed on ${completedBill.dateCompleted || 'unknown date'}`, 'info');
                        console.log('ℹ️ Found already completed bill after refresh:', completedBill);
                        return true;
                    }

                    if (bill) {
                        console.log('✅ Found bill after data refresh!');
                    }
                } catch (refreshError) {
                    console.error('Failed to refresh data:', refreshError);
                }

                if (!bill || !sourceArray) {
                    showToast('Bill not found. The bill may have been moved or completed already. Please refresh the page and try again.', 'error');
                    showToast('Failed to complete Ugrai', 'info'); // Match the original error message pattern
                    return false;
                }
            }

            console.log(`✅ Found bill ${billId} in ${sourceArray}, removing from source and completing...`);

            // Apply updates
            Object.assign(bill, updates);
            bill.status = 'Completed';
            bill.dateCompleted = new Date().toISOString().split('T')[0];

            // Check if this is a full payment or partial payment
            const receivedAmount = parseFloat(bill.receivedAmount || updates.receivedAmount || 0);
            const netAmount = parseFloat(bill.netAmount || 0);
            const isFullPayment = receivedAmount >= netAmount;
            const isPartialPayment = receivedAmount < netAmount && receivedAmount > 0;

            console.log(`💰 Payment check: Received=₹${receivedAmount}, Net=₹${netAmount}, Full Payment=${isFullPayment}`);

            // Ensure boolean fields are proper booleans for database
            if (bill.photoUploaded !== undefined) {
                bill.photoUploaded = Boolean(bill.photoUploaded);
            }

            // Clean up any other potential boolean fields
            Object.keys(bill).forEach(key => {
                if (typeof bill[key] === 'object' && bill[key] !== null && !(bill[key] instanceof Date)) {
                    // Convert objects to boolean if they seem to be boolean-ish fields
                    if (key.toLowerCase().includes('uploaded') || key.toLowerCase().includes('approved') ||
                        key.toLowerCase().includes('completed') || key.toLowerCase().includes('active')) {
                        bill[key] = Boolean(bill[key]);
                        console.log('🔧 Converted', key, 'from object to boolean:', bill[key]);
                    }
                }
            });

            // Ensure bill date exists to satisfy DB NOT NULL constraints
            if (!bill.billDate && !bill.bill_date) {
                // Try to find bill date from appState sources (ugraiData / ugraiEntries)
                try {
                    let sourceBill = null;
                    if (appState && appState.data) {
                        const idOrNumber = bill.id || bill.billNumber;
                        if (appState.data.ugraiData && appState.data.ugraiData.length) {
                            sourceBill = appState.data.ugraiData.find(b => b.id === idOrNumber || b.billNumber === idOrNumber);
                        }
                        if (!sourceBill && appState.data.ugraiEntries && appState.data.ugraiEntries.length) {
                            sourceBill = appState.data.ugraiEntries.find(b => b.id === idOrNumber || b.billNumber === idOrNumber);
                        }
                        // FIXED: Also check approved credit bills (supply bills)
                        if (!sourceBill && appState.data.approvedBills && appState.data.approvedBills.length) {
                            sourceBill = appState.data.approvedBills.find(b =>
                                (b.id === idOrNumber || b.billNumber === idOrNumber) && b.deliveryMethod === 'Credit'
                            );
                        }
                    }

                    // Prefer provided updates, then sourceBill, then dateCompleted, then today
                    const today = new Date().toISOString().split('T')[0];
                    bill.billDate = (updates && (updates.billDate || updates.dateCompleted)) || (sourceBill && (sourceBill.billDate || sourceBill.bill_date)) || bill.dateCompleted || today;
                } catch (err) {
                    console.error('Error deriving billDate for completed UGRAI:', err);
                    bill.billDate = bill.dateCompleted || new Date().toISOString().split('T')[0];
                }
            }

            if (mockMode) {
                // Remove from source array ONLY if it's a full payment
                // For partial payments, keep in ugrai_data
                if (isFullPayment || sourceArray !== 'ugraiData') {
                    if (sourceArray === 'ugraiData') {
                        this.data.ugraiData.splice(billIndex, 1);
                        console.log(`✅ Removed bill from ugrai_data (full payment)`);
                    } else if (sourceArray === 'ugraiEntries') {
                        this.data.ugraiEntries.splice(billIndex, 1);
                    } else if (sourceArray === 'ugraiInProgress') {
                        this.data.ugraiInProgress.splice(billIndex, 1);
                    } else if (sourceArray === 'approvedBills') {
                        this.data.approvedBills.splice(billIndex, 1);
                    }
                } else if (isPartialPayment && sourceArray === 'ugraiData') {
                    // Partial payment: keep in ugrai_data with updated amount
                    const outstandingAmount = netAmount - receivedAmount;
                    this.data.ugraiData[billIndex].netAmount = outstandingAmount;
                    this.data.ugraiData[billIndex].status = 'Pending';
                    console.log(`💰 Partial payment: Updated ugrai_data with outstanding ₹${outstandingAmount}`);
                }

                // Add to completedUgrai array (create if doesn't exist)
                if (!this.data.completedUgrai) {
                    this.data.completedUgrai = [];
                }

                // Prevent duplicates: if an existing completed record exists, replace it
                const existingIndexMock = this.data.completedUgrai.findIndex(b => b.id === (bill.id || bill.billNumber) || b.billNumber === (bill.billNumber || bill.id));
                if (existingIndexMock !== -1) {
                    this.data.completedUgrai[existingIndexMock] = { ...this.data.completedUgrai[existingIndexMock], ...bill };
                } else {
                    this.data.completedUgrai.push(bill);
                }

                // Clean up any remaining duplicates after completion
                this.cleanupDuplicateUgraiBills();

                renderDashboard();
                console.log(`Ugrai bill ${billId} completed with:`, updates);
                showToast('UGRAI bill completed successfully!', 'success');
                return true;
            }

            // Supabase mode
            console.log('🔄 Attempting to save completed UGRAI to Supabase:', bill.billNumber);

            // First check if this bill is already approved (ghost bill detection)
            const alreadyApproved = await this.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);
            if (alreadyApproved) {
                console.log('👻 GHOST BILL DETECTED: Bill', bill.billNumber, 'was already approved on', alreadyApproved.date_approved);
                showToast(`This bill (${bill.billNumber}) was already approved on ${alreadyApproved.date_approved}. Skipping completion.`, 'warning');

                // Remove from local arrays to prevent future issues
                if (sourceArray === 'ugraiData') {
                    this.data.ugraiData.splice(billIndex, 1);
                } else if (sourceArray === 'ugraiEntries') {
                    this.data.ugraiEntries.splice(billIndex, 1);
                } else if (sourceArray === 'ugraiInProgress') {
                    this.data.ugraiInProgress.splice(billIndex, 1);
                } else if (sourceArray === 'approvedBills') {
                    this.data.approvedBills.splice(billIndex, 1);
                }

                renderDashboard();
                return false; // Don't proceed with completion
            }

            // Check if already exists in completed table to avoid duplicate errors
            const existingCompleted = await this.supabaseService.getCompletedUgraiByBillNumber(bill.billNumber);

            if (existingCompleted) {
                console.log('📋 Bill already completed, updating existing record:', bill.billNumber, 'ID:', existingCompleted.id);
                await this.supabaseService.updateCompletedUgrai(existingCompleted.id, bill);
                bill.id = existingCompleted.id;
                console.log('✅ Updated existing completed UGRAI in Supabase:', bill.billNumber);
            } else {
                try {
                    console.log('🔍 Sending bill data to Supabase:', JSON.stringify(bill, null, 2));
                    const added = await this.supabaseService.addCompletedUgrai(bill);
                    if (added && added.id) {
                        bill.id = added.id;
                        console.log('✅ Successfully saved new completed UGRAI to Supabase:', bill.billNumber, 'with ID:', added.id);
                    } else {
                        console.warn('⚠️ Completed UGRAI saved but no ID returned:', bill.billNumber);
                    }
                } catch (err) {
                    console.error('❌ Error adding completed UGRAI:', err);
                    // Handle duplicate key error as fallback
                    if (err && err.code === '23505') {
                        console.log('🔄 Duplicate detected, retrying with update approach...');
                        const completed = await this.supabaseService.getCompletedUgrai();
                        const existing = (completed || []).find(item => item.billNumber === (bill.billNumber || bill.id));
                        if (existing && existing.id) {
                            console.log('Found existing completed UGRAI record, updating instead of inserting:', existing.id);
                            await this.supabaseService.updateCompletedUgrai(existing.id, bill);
                            bill.id = existing.id;
                        } else {
                            throw err;
                        }
                    } else {
                        throw err;
                    }
                }
            }

            // Update local data
            // Remove from source array ONLY if it's a full payment
            // For partial payments, keep in ugrai_data
            if (isFullPayment || sourceArray !== 'ugraiData') {
                if (sourceArray === 'ugraiData') {
                    this.data.ugraiData.splice(billIndex, 1);
                    console.log(`✅ Removed bill from ugrai_data (full payment)`);

                    // Also remove from database
                    try {
                        await this.supabaseService.removeUgraiData(bill.billNumber || bill.id);
                        console.log(`✅ Removed bill from ugrai_data table in database`);
                    } catch (error) {
                        console.error('Error removing from ugrai_data:', error);
                    }
                } else if (sourceArray === 'ugraiEntries') {
                    this.data.ugraiEntries.splice(billIndex, 1);

                    // Also remove from database
                    try {
                        await this.supabaseService.removeUgraiEntryById(bill.id || bill.sourceId);
                        console.log(`✅ Removed bill from ugrai_entries table in database`);
                    } catch (error) {
                        console.error('Error removing from ugrai_entries:', error);
                    }
                } else if (sourceArray === 'ugraiInProgress') {
                    // Bill is in ugrai_in_progress - remove from local array
                    this.data.ugraiInProgress.splice(billIndex, 1);
                    console.log(`✅ Removed bill from ugraiInProgress local array`);

                    // Remove from ugrai_in_progress database table
                    try {
                        await this.supabaseService.removeUgraiInProgress(bill.id);
                        console.log(`✅ Removed bill from ugrai_in_progress table in database`);
                    } catch (error) {
                        console.error('Error removing from ugrai_in_progress:', error);
                    }

                    // CRITICAL: Also remove from original source table if full payment
                    if (isFullPayment && bill.sourceTable && bill.sourceId) {
                        console.log(`🗑️ Full payment - removing from original source: ${bill.sourceTable}, ID: ${bill.sourceId}`);

                        if (bill.sourceTable === 'ugrai_data') {
                            // Remove from ugrai_data database
                            try {
                                await this.supabaseService.removeUgraiData(bill.sourceId);
                                console.log(`✅ Removed from ugrai_data source table`);

                                // Also remove from local array if present
                                const dataIndex = this.data.ugraiData?.findIndex(b => b.id === bill.sourceId);
                                if (dataIndex !== undefined && dataIndex !== -1) {
                                    this.data.ugraiData.splice(dataIndex, 1);
                                }
                            } catch (error) {
                                console.error('Error removing from ugrai_data source:', error);
                            }
                        } else if (bill.sourceTable === 'ugrai_entries') {
                            // Remove from ugrai_entries database
                            try {
                                await this.supabaseService.removeUgraiEntryById(bill.sourceId);
                                console.log(`✅ Removed from ugrai_entries source table`);

                                // Also remove from local array if present
                                const entryIndex = this.data.ugraiEntries?.findIndex(b => b.id === bill.sourceId);
                                if (entryIndex !== undefined && entryIndex !== -1) {
                                    this.data.ugraiEntries.splice(entryIndex, 1);
                                }
                            } catch (error) {
                                console.error('Error removing from ugrai_entries source:', error);
                            }
                        }
                    }
                } else if (sourceArray === 'approvedBills') {
                    this.data.approvedBills.splice(billIndex, 1);
                } else if (sourceArray === 'processedTotalUgrai') {
                    console.log('🔍 Bill found in processedTotalUgrai, determining source table and deleting...');
                    console.log('  - Bill ID:', bill.id, '(type:', typeof bill.id, ')');
                    console.log('  - Bill Number:', bill.billNumber);

                    // Determine source table by checking which array contains this bill
                    let sourceTable = null;
                    let deletionSuccess = false;

                    // Check ugrai_data first
                    const inUgraiData = this.data.ugraiData?.find(b =>
                        b.id === bill.id || b.billNumber === bill.billNumber
                    );

                    // Check ugrai_entries
                    const inUgraiEntries = this.data.ugraiEntries?.find(b =>
                        b.id === bill.id || b.billNumber === bill.billNumber
                    );

                    // Delete from the correct source table using the database UUID
                    if (inUgraiData) {
                        sourceTable = 'ugrai_data';
                        console.log('  📍 Source: ugrai_data, using ID:', inUgraiData.id);
                        try {
                            deletionSuccess = await this.supabaseService.removeUgraiDataById(inUgraiData.id);
                            if (deletionSuccess) {
                                console.log(`✅ Removed bill from ugrai_data table`);
                                // Remove from local array
                                const dataIndex = this.data.ugraiData?.findIndex(b => b.id === inUgraiData.id);
                                if (dataIndex !== undefined && dataIndex !== -1) {
                                    this.data.ugraiData.splice(dataIndex, 1);
                                }
                            }
                        } catch (error) {
                            console.error('❌ Error deleting from ugrai_data:', error);
                            throw error; // Re-throw to prevent silent failure
                        }
                    } else if (inUgraiEntries) {
                        sourceTable = 'ugrai_entries';
                        console.log('  📍 Source: ugrai_entries, using ID:', inUgraiEntries.id);
                        try {
                            deletionSuccess = await this.supabaseService.removeUgraiEntryById(inUgraiEntries.id);
                            if (deletionSuccess) {
                                console.log(`✅ Removed bill from ugrai_entries table`);
                                // Remove from local array
                                const entryIndex = this.data.ugraiEntries?.findIndex(b => b.id === inUgraiEntries.id);
                                if (entryIndex !== undefined && entryIndex !== -1) {
                                    this.data.ugraiEntries.splice(entryIndex, 1);
                                }
                            }
                        } catch (error) {
                            console.error('❌ Error deleting from ugrai_entries:', error);
                            throw error; // Re-throw to prevent silent failure
                        }
                    } else {
                        console.warn('⚠️ Bill not found in ugrai_data or ugrai_entries - may have been already deleted');
                        // Don't throw error here as bill might already be moved
                    }

                    if (!deletionSuccess && (inUgraiData || inUgraiEntries)) {
                        throw new Error(`Failed to delete bill from ${sourceTable}`);
                    }
                }
            } else if (isPartialPayment && sourceArray === 'ugraiData') {
                // Partial payment: keep in ugrai_data with updated outstanding amount
                const outstandingAmount = netAmount - receivedAmount;
                this.data.ugraiData[billIndex].netAmount = outstandingAmount;
                this.data.ugraiData[billIndex].status = 'Pending';
                console.log(`💰 Partial payment: Keeping in ugrai_data with outstanding ₹${outstandingAmount}`);

                // Update in database
                try {
                    await this.supabaseService.updateUgraiData(bill.billNumber || bill.id, {
                        netAmount: outstandingAmount,
                        status: 'Pending'
                    });
                    console.log(`✅ Updated ugrai_data in database with outstanding amount`);
                } catch (error) {
                    console.error('Error updating ugrai_data:', error);
                }
            }

            // Update local completedUgrai array immediately for better UX
            if (!this.data.completedUgrai) {
                this.data.completedUgrai = [];
            }

            // Prevent duplicates in completedUgrai: replace existing if present
            const existingLocalIndex = this.data.completedUgrai.findIndex(b =>
                b.id === (bill.id || bill.billNumber) ||
                b.billNumber === (bill.billNumber || bill.id)
            );

            if (existingLocalIndex !== -1) {
                this.data.completedUgrai[existingLocalIndex] = { ...this.data.completedUgrai[existingLocalIndex], ...bill };
                console.log('🔄 Updated existing completed UGRAI in local data:', bill.billNumber);
            } else {
                this.data.completedUgrai.push(bill);
                console.log('➕ Added new completed UGRAI to local data:', bill.billNumber, '| Total:', this.data.completedUgrai.length);
            }

            if (!mockMode) {
                // Also verify with a delayed refresh to ensure sync
                setTimeout(async () => {
                    try {
                        console.log('🔄 Verifying completed UGRAI data sync...');
                        const freshData = await this.supabaseService.getCompletedUgrai();
                        const freshCount = freshData?.length || 0;
                        const localCount = this.data.completedUgrai?.length || 0;

                        if (freshCount !== localCount) {
                            console.log('⚠️ Data sync mismatch detected - refreshing local data');
                            this.data.completedUgrai = freshData || [];
                            renderDashboard();
                        }

                        console.log('✅ Completed UGRAI data verified:', freshCount, 'items in database,', localCount, 'items locally');
                    } catch (verifyError) {
                        console.error('❌ Error verifying completed UGRAI sync:', verifyError);
                    }
                }, 2000);
            }

            // Clean up any remaining duplicates after completion
            this.cleanupDuplicateUgraiBills();

            renderDashboard();
            console.log(`Ugrai bill ${billId} completed with:`, updates);
            showToast('UGRAI bill completed successfully!', 'success');
            return true;

        } catch (error) {
            console.error('❌ Error completing UGRAI bill:', error);
            showToast('Error completing UGRAI bill', 'error');
            return false;
        }
    }
    async updateCompletedUgraiBill(billId, updates) {
        try {
            const billIndex = this.data.completedUgrai.findIndex(b =>
                b.id === billId || b.billNumber === billId
            );

            if (billIndex === -1) {
                console.error(`Ugrai bill ${billId} not found in completedUgrai`);
                showToast('Bill not found', 'error');
                return false;
            }

            if (mockMode) {
                Object.assign(this.data.completedUgrai[billIndex], updates);
                renderDashboard();
                console.log(`Ugrai bill ${billId} updated with:`, updates);
                showToast('UGRAI bill updated successfully!', 'success');
                return true;
            }

            // Supabase mode
            await this.supabaseService.updateCompletedUgrai(billId, updates);

            // Update local data
            Object.assign(this.data.completedUgrai[billIndex], updates);

            renderDashboard();
            console.log(`Ugrai bill ${billId} updated with:`, updates);
            showToast('UGRAI bill updated successfully!', 'success');
            return true;

        } catch (error) {
            console.error('❌ Error updating completed UGRAI bill:', error);
            showToast('Error updating UGRAI bill', 'error');
            return false;
        }
    }

    // General update method that can handle bills in any stage
    async updateUgraiBill(billId, updates) {
        try {
            console.log('🔍 updateUgraiBill called with billId:', billId, 'type:', typeof billId);
            // First check if it's in completedUgrai (most likely for edit operations)
            if (this.data.completedUgrai && this.data.completedUgrai.length > 0) {
                const completedIndex = this.data.completedUgrai.findIndex(b =>
                    b.id === billId || b.billNumber === billId
                );
                if (completedIndex !== -1) {
                    return await this.updateCompletedUgraiBill(billId, updates);
                }
            }

            // If not found in completed, use comprehensive search for bills in progress
            await this.ensureDataConsistency();
            const searchResult = this.findBillAcrossAllSources(billId);

            let bill = searchResult.bill;
            let billIndex = searchResult.index;
            let sourceArray = searchResult.sourceArray;

            if (!bill) {
                if (searchResult.alreadyCompleted) {
                    console.log('ℹ️ Bill is already completed - this should be handled by the first check');
                    return await this.updateCompletedUgraiBill(billId, updates);
                }

                console.error(`🔍 updateUgraiBill: Ugrai bill ${billId} not found in any array`);
                console.log('🔍 Available data sources:');
                console.log('  - ugraiData:', this.data.ugraiData?.length || 0, 'items');
                console.log('  - ugraiEntries:', this.data.ugraiEntries?.length || 0, 'items');
                console.log('  - ugraiInProgress:', this.data.ugraiInProgress?.length || 0, 'items');
                console.log('  - approvedBills:', this.data.approvedBills?.length || 0, 'items');
                showToast('Bill not found', 'error');
                return false;
            }

            // Update the bill in the appropriate array
            if (sourceArray === 'ugraiData') {
                Object.assign(this.data.ugraiData[billIndex], updates);
            } else if (sourceArray === 'ugraiEntries') {
                Object.assign(this.data.ugraiEntries[billIndex], updates);
            } else if (sourceArray === 'ugraiInProgress') {
                Object.assign(this.data.ugraiInProgress[billIndex], updates);
            } else if (sourceArray === 'approvedBills') {
                Object.assign(this.data.approvedBills[billIndex], updates);
            }

            // Update in Supabase if not in mock mode
            if (!mockMode && this.supabaseService) {
                if (sourceArray === 'ugraiData') {
                    await this.supabaseService.updateUgraiData(billId, updates);
                } else if (sourceArray === 'ugraiEntries') {
                    await this.supabaseService.updateUgraiEntries(billId, updates);
                } else if (sourceArray === 'ugraiInProgress') {
                    await this.supabaseService.updateUgraiInProgress(billId, updates);
                } else if (sourceArray === 'approvedBills') {
                    // For supply bills, update in the bills table
                    await this.supabaseService.updateBill(billId, updates);
                }
            }

            renderDashboard();
            console.log(`Ugrai bill ${billId} updated in ${sourceArray} with:`, updates);
            showToast('UGRAI bill updated successfully!', 'success');
            return true;

        } catch (error) {
            console.error('❌ Error updating UGRAI bill:', error);
            showToast('Error updating UGRAI bill', 'error');
            return false;
        }
    }

    // =============================================================================
    // UGRAI BILL APPROVAL METHODS
    // =============================================================================
    // These methods use the approve_ugrai_bills() SQL function which atomically:
    // 1. Deletes bills from source tables (ugrai_data or ugrai_entries)
    // 2. Updates ugrai_completed records
    // 3. Maintains data consistency
    // =============================================================================

    // Batch approve multiple UGRAI bills using SQL function
    async approveUgraiBillsBatch(billIds) {
        try {
            console.log('👍 Batch approving UGRAI bills:', billIds);

            if (!this.data.completedUgrai || this.data.completedUgrai.length === 0) {
                console.error("No completedUgrai array found");
                showToast('No completed UGRAI bills found', 'error');
                return false;
            }

            // Get bill numbers from IDs
            const billNumbers = billIds.map(billId => {
                const bill = this.data.completedUgrai.find(b => b.id === billId || b.billNumber === billId);
                return bill ? bill.billNumber : null;
            }).filter(bn => bn !== null);

            if (billNumbers.length === 0) {
                console.error('No valid bills found to approve');
                showToast('No valid bills found to approve', 'error');
                return false;
            }

            if (mockMode) {
                // Mock mode - just remove from completed
                billIds.forEach(billId => {
                    const billIndex = this.data.completedUgrai.findIndex(b => b.id === billId || b.billNumber === billId);
                    if (billIndex !== -1) {
                        this.data.completedUgrai.splice(billIndex, 1);
                    }
                });
                renderDashboard();
                return true;
            }

            // Supabase mode - manually approve each bill
            console.log('📤 Batch approving bills manually:', billNumbers.length, 'bills');

            let successCount = 0;
            let errorCount = 0;

            for (const billId of billIds) {
                const billIndex = this.data.completedUgrai.findIndex(b => b.id === billId || b.billNumber === billId);
                if (billIndex === -1) continue;

                const bill = this.data.completedUgrai[billIndex];

                try {
                    // ✅ FIX: Fetch previous payment history to calculate cumulative outstanding
                    const previousPayments = await this.supabaseService.getUgraiPaymentHistory(bill.billNumber) || [];
                    const totalPreviousPaid = previousPayments.reduce((sum, p) => sum + parseFloat(p.paymentAmount || p.payment_amount || 0), 0);

                    // Get original amount (use originalNetAmount if available, fallback to netAmount)
                    const originalNetAmount = parseFloat(bill.originalNetAmount || bill.netAmount || 0);
                    const currentPayment = parseFloat(bill.receivedAmount || 0);
                    const totalPaid = totalPreviousPaid + currentPayment;
                    const outstandingAmount = originalNetAmount - totalPaid;
                    const isPartialPayment = outstandingAmount > 0.01; // Allow small rounding errors

                    console.log(`💰 Payment calculation for ${bill.billNumber}:`);
                    console.log(`   Original: ₹${originalNetAmount}`);
                    console.log(`   Previous paid: ₹${totalPreviousPaid} (${previousPayments.length} payments)`);
                    console.log(`   Current payment: ₹${currentPayment}`);
                    console.log(`   Total paid: ₹${totalPaid}`);
                    console.log(`   Outstanding: ₹${outstandingAmount}`);

                    if (isPartialPayment) {
                        console.log(`⚠️ PARTIAL PAYMENT in batch: ${bill.billNumber} - Received ₹${currentPayment} of ₹${originalNetAmount}`);
                    }

                    // Save payment history with correct payment type and cumulative outstanding
                    await this.supabaseService.addUgraiPaymentHistory({
                        billNumber: bill.billNumber,
                        billDate: bill.billDate,
                        retailerName: bill.retailerName,
                        sector: bill.sector,
                        originalNetAmount: originalNetAmount,
                        receivedAmount: currentPayment,
                        outstandingAmount: outstandingAmount,
                        paymentType: isPartialPayment ? 'partial' : 'full',  // ✅ FIX: Use actual payment type
                        paymentMethod: bill.paymentMethod,
                        receiptNumber: bill.receiptNumber,
                        chequeDate: bill.chequeDate,
                        photoUploaded: bill.photoUploaded,
                        photoUrl: bill.photoUrl,
                        dateCompleted: bill.dateCompleted,
                        completedBy: bill.completedBy || bill.assignedTo,
                        approvedBy: this.currentUser?.email || 'Manager',
                        sourceBillId: bill.id,
                        notes: isPartialPayment
                            ? `Batch approval - Payment ${previousPayments.length + 1}: ₹${currentPayment} (Total paid: ₹${totalPaid} of ₹${originalNetAmount})`
                            : `Batch approval - Final payment ${previousPayments.length + 1}: ₹${currentPayment} (Total: ₹${totalPaid})`
                    });

                    // ✅ FIX: Handle partial payments differently
                    if (isPartialPayment) {
                        // For partial payments: update ugrai_data instead of moving to approved_ugrai
                        console.log(`💰 Partial payment - moving back to ugrai_data with outstanding ₹${outstandingAmount}`);

                        // Delete from completed_ugrai
                        await this.supabaseService.removeCompletedUgrai(bill.id);

                        // CRITICAL: Also delete from approved_ugrai if exists (for re-processed partial payments)
                        try {
                            const existingApproved = await this.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);
                            if (existingApproved) {
                                console.log(`🗑️ Removing from approved_ugrai: ${bill.billNumber}`);
                                await this.supabaseService.deleteFromTable('approved_ugrai', 'bill_number', bill.billNumber);
                            }
                        } catch (e) {
                            console.warn('⚠️ Could not check/remove from approved_ugrai:', e);
                        }

                        // Add back to ugrai_data with outstanding amount and tracking fields
                        const updatedBill = {
                            billNumber: bill.billNumber,
                            billDate: bill.billDate,
                            retailerName: bill.retailerName,
                            sector: bill.sector,
                            originalNetAmount: originalNetAmount,  // Keep original amount
                            netAmount: originalNetAmount,           // Show remaining balance
                            receivedAmount: totalPaid,              // ✅ FIX: Total cumulative amount paid
                            totalPaid: totalPaid,                   // Cumulative paid amount
                            status: 'Pending'
                        };
                        await this.supabaseService.addUgraiData([updatedBill]);

                        // Remove from local array
                        this.data.completedUgrai.splice(billIndex, 1);

                        successCount++;
                        console.log(`✅ Partial payment processed for ${bill.billNumber}`);
                        continue; // Skip the approved_ugrai insertion below
                    }

                    // Insert into approved_ugrai (only for full payments)
                    const approvedUgrai = {
                        bill_number: bill.billNumber,
                        bill_date: bill.billDate,
                        retailer_name: bill.retailerName,
                        sector: bill.sector || 'Unknown',
                        net_amount: originalNetAmount,
                        received_amount: totalPaid,
                        payment_method: bill.paymentMethod || '',
                        receipt_number: bill.receiptNumber || '',
                        cheque_date: bill.chequeDate || null,
                        photo_url: bill.photoUrl || '',
                        photo_uploaded: bill.photoUploaded || false,
                        date_completed: bill.dateCompleted || new Date().toISOString().split('T')[0],
                        date_approved: new Date().toISOString().split('T')[0],
                        approved_by: this.currentUser?.email || 'Manager',
                        assigned_to: bill.assignedTo || bill.completedBy || '',
                        user_id: this.supabaseService.userId
                    };

                    await this.supabaseService.addApprovedUgrai(approvedUgrai);

                    // Delete from completed_ugrai
                    console.log(`🗑️ Deleting bill from completed_ugrai. Bill ID: ${bill.id}, Bill Number: ${bill.billNumber}`);
                    await this.supabaseService.removeCompletedUgrai(bill.id);
                    console.log(`✅ Successfully deleted bill ${bill.billNumber} from completed_ugrai`);

                    // Remove from local array
                    this.data.completedUgrai.splice(billIndex, 1);
                    console.log(`✅ Removed bill from local array. Remaining: ${this.data.completedUgrai.length}`);

                    // Add to approved list for local tracking
                    if (!this.data.approvedUgrai) {
                        this.data.approvedUgrai = [];
                    }
                    this.data.approvedUgrai.push({
                        ...bill,
                        status: 'Approved',
                        dateApproved: new Date().toISOString().split('T')[0]
                    });

                    successCount++;

                } catch (approveError) {
                    if (approveError.code === '23505') {
                        // Duplicate - still remove from completed_ugrai
                        await this.supabaseService.removeCompletedUgrai(bill.id);
                        this.data.completedUgrai.splice(billIndex, 1);
                        successCount++;
                    } else {
                        console.error(`❌ Error approving bill ${bill.billNumber}:`, approveError);
                        errorCount++;
                    }
                }
            }

            console.log(`✅ Batch approval complete: ${successCount} bills approved, ${errorCount} errors`);

            // Reload UGRAI data to reflect changes
            await this.loadUgraiData();

            renderDashboard();

            if (errorCount > 0) {
                showToast(`Approved ${successCount} bills with ${errorCount} errors`, 'warning');
            } else {
                showToast(`Successfully approved ${successCount} bills`, 'success');
            }

            return true;

        } catch (error) {
            console.error('❌ Error in batch approval:', error);
            showToast('Error approving bills', 'error');
            return false;
        }
    }

    // Add method to approve single Ugrai bill
    async approveUgraiBill(billId) {
        try {
            if (!this.data.completedUgrai) {
                console.error("No completedUgrai array found");
                showToast('No completed UGRAI bills found', 'error');
                return false;
            }

            const billIndex = this.data.completedUgrai.findIndex(b =>
                b.id === billId || b.billNumber === billId);

            if (billIndex === -1) {
                console.error(`Ugrai bill ${billId} not found`);
                showToast('Bill not found', 'error');
                return false;
            }

            const bill = { ...this.data.completedUgrai[billIndex] };

            // ✅ FIX: Fetch previous payment history to calculate cumulative outstanding
            const previousPayments = await this.supabaseService.getUgraiPaymentHistory(bill.billNumber) || [];
            const totalPreviousPaid = previousPayments.reduce((sum, p) => sum + parseFloat(p.paymentAmount || p.payment_amount || 0), 0);

            // Get original amount (use originalNetAmount if available, fallback to netAmount)
            const originalNetAmount = parseFloat(bill.originalNetAmount || bill.netAmount || 0);
            const currentPayment = parseFloat(bill.receivedAmount || 0);
            const totalPaid = totalPreviousPaid + currentPayment;
            const outstandingAmount = originalNetAmount - totalPaid;
            const isPartialPayment = outstandingAmount > 0.01; // Allow small rounding errors

            console.log(`💰 Single approval payment calculation for ${bill.billNumber}:`);
            console.log(`   Original: ₹${originalNetAmount}`);
            console.log(`   Previous paid: ₹${totalPreviousPaid} (${previousPayments.length} payments)`);
            console.log(`   Current payment: ₹${currentPayment}`);
            console.log(`   Total paid: ₹${totalPaid}`);
            console.log(`   Outstanding: ₹${outstandingAmount}`);

            if (isPartialPayment) {
                console.log(`⚠️ Partial payment detected: Received ₹${currentPayment} of ₹${originalNetAmount}`);
                console.log(`💰 Outstanding amount: ₹${outstandingAmount}`);
            }

            bill.status = 'Approved';
            bill.dateApproved = new Date().toISOString().split('T')[0];

            if (mockMode) {
                // Remove from completed Ugrai
                this.data.completedUgrai.splice(billIndex, 1);

                if (isPartialPayment) {
                    // Update the bill in ugrai base file with outstanding amount
                    const updatedBill = {
                        ...bill,
                        originalNetAmount: originalNetAmount,
                        netAmount: outstandingAmount,
                        receivedAmount: currentPayment,
                        totalPaid: totalPaid,
                        status: 'Pending',
                        dateApproved: null
                    };

                    // Add back to ugrai base file
                    if (!this.data.ugraiBaseFile) {
                        this.data.ugraiBaseFile = [];
                    }
                    this.data.ugraiBaseFile.push(updatedBill);

                    console.log(`🔄 Bill updated in ugrai base file with outstanding amount: ₹${outstandingAmount}`);
                    showToast(`Partial payment approved. Outstanding: ₹${outstandingAmount.toFixed(2)}`, 'warning');
                } else {
                    // Full payment - send to Google Sheets (mock implementation)
                    console.log(`📤 Sending Ugrai bill to Google Sheets (mock):`, bill);

                    // Add to approved Ugrai array if needed for history
                    if (!this.data.approvedUgrai) {
                        this.data.approvedUgrai = [];
                    }
                    this.data.approvedUgrai.push(bill);

                    console.log(`Ugrai bill ${billId} approved`);
                    showToast('UGRAI bill approved successfully!', 'success');
                }

                // Update UI
                renderDashboard();
                return true;
            }

            // Supabase mode
            try {
                // ⚠️ CHECK IF ALREADY APPROVED FIRST (before saving payment history)
                console.log(`🔍 Checking if bill ${bill.billNumber} is already approved...`);
                const existingApprovedBill = await this.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);

                if (existingApprovedBill) {
                    console.log(`⚠️ Bill ${bill.billNumber} is already approved! Skipping payment history save.`);

                    // Check if bill exists in completed_ugrai and remove it
                    const billInCompleted = await this.supabaseService.checkBillExistsInCompletedUgrai(bill.billNumber);
                    if (billInCompleted) {
                        await this.supabaseService.removeCompletedUgrai(billInCompleted.id);
                        console.log(`✅ Cleaned up duplicate from completed_ugrai`);
                    }

                    // Remove from local array
                    this.data.completedUgrai.splice(billIndex, 1);

                    // Reload data and update UI
                    await this.loadUgraiData();
                    renderDashboard();

                    showToast('Bill already approved (duplicate removed)', 'warning');
                    return true;
                }

                // Bill not yet approved - proceed with normal approval flow
                // 💾 SAVE PAYMENT HISTORY
                await this.supabaseService.addUgraiPaymentHistory({
                    billNumber: bill.billNumber,
                    billDate: bill.billDate,
                    retailerName: bill.retailerName,
                    sector: bill.sector,
                    originalNetAmount: originalNetAmount,
                    receivedAmount: currentPayment,
                    outstandingAmount: outstandingAmount,
                    paymentType: isPartialPayment ? 'partial' : 'full',
                    paymentMethod: bill.paymentMethod,
                    receiptNumber: bill.receiptNumber,
                    chequeDate: bill.chequeDate,
                    photoUploaded: bill.photoUploaded,
                    photoUrl: bill.photoUrl,
                    dateCompleted: bill.dateCompleted,
                    completedBy: bill.completedBy || bill.assignedTo,
                    approvedBy: appState.currentUser?.email || 'Manager',
                    sourceBillId: bill.id,
                    notes: isPartialPayment
                        ? `Single approval - Payment ${previousPayments.length + 1}: ₹${currentPayment} (Total paid: ₹${totalPaid} of ₹${originalNetAmount})`
                        : `Single approval - Final payment ${previousPayments.length + 1}: ₹${currentPayment} (Total: ₹${totalPaid})`
                });
                console.log(`✅ Payment history saved for bill ${bill.billNumber}`);

                if (isPartialPayment) {
                    // For partial payments, handle separately (no SQL function support yet)
                    await this.supabaseService.removeCompletedUgrai(billId);

                    // CRITICAL FIX: Check and remove from approved_ugrai if exists
                    try {
                        const existingApproved = await this.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);
                        if (existingApproved) {
                            console.log(`🗑️ Removing from approved_ugrai: ${bill.billNumber}`);
                            await this.supabaseService.deleteFromTable('approved_ugrai', 'bill_number', bill.billNumber);
                        }
                    } catch (e) {
                        console.warn('⚠️ Could not check/remove from approved_ugrai:', e);
                    }

                    // CRITICAL FIX: Keep original netAmount, track receivedAmount and cumulative totals
                    const updatedBill = {
                        billNumber: bill.billNumber,
                        billDate: bill.billDate,
                        retailerName: bill.retailerName,
                        sector: bill.sector,
                        originalNetAmount: originalNetAmount,  // ✅ Keep original amount
                        netAmount: originalNetAmount,          // ✅ FIX: Must be original, not outstanding! Prevents double subtraction
                        receivedAmount: totalPaid,             // ✅ FIX: Total cumulative amount paid
                        totalPaid: totalPaid,                  // ✅ Track cumulative paid
                        status: 'Pending'
                    };

                    // Add back to ugrai base file using addUgraiData
                    await this.supabaseService.addUgraiData([updatedBill]);

                    // Reload ugrai data to refresh the base file
                    await this.loadUgraiData();

                    // Update local data
                    this.data.completedUgrai.splice(billIndex, 1);

                    console.log(`🔄 Bill updated in ugrai_data: Outstanding ₹${outstandingAmount}, Total Paid ₹${totalPaid}`);
                    showToast(`Partial payment approved. Outstanding: ₹${outstandingAmount.toFixed(2)}`, 'warning');
                } else {
                    // Full payment - manually approve the bill
                    console.log('📤 Manually approving UGRAI bill:', bill.billNumber);

                    try {
                        // Insert into approved_ugrai table (this is what Payment Received Analysis reads from)
                        const approvedUgrai = {
                            bill_number: bill.billNumber,
                            bill_date: bill.billDate,
                            retailer_name: bill.retailerName,
                            sector: bill.sector || 'Unknown',
                            net_amount: originalNetAmount,
                            received_amount: totalPaid,
                            payment_method: bill.paymentMethod || '',
                            receipt_number: bill.receiptNumber || '',
                            cheque_date: bill.chequeDate || null,
                            photo_url: bill.photoUrl || '',
                            photo_uploaded: bill.photoUploaded || false,
                            date_completed: bill.dateCompleted || new Date().toISOString().split('T')[0],
                            date_approved: new Date().toISOString().split('T')[0],
                            approved_by: this.currentUser?.email || 'Manager',
                            assigned_to: bill.assignedTo || bill.completedBy || '',
                            user_id: this.supabaseService.userId
                        };

                        await this.supabaseService.addApprovedUgrai(approvedUgrai);
                        console.log(`✅ Bill inserted into approved_ugrai`);

                        // Delete from completed_ugrai - verify it exists first
                        console.log(`🔍 Checking if bill exists in completed_ugrai before deletion...`);
                        const billInCompleted = await this.supabaseService.checkBillExistsInCompletedUgrai(bill.billNumber);
                        if (billInCompleted) {
                            await this.supabaseService.removeCompletedUgrai(billInCompleted.id);
                            console.log(`✅ Bill deleted from completed_ugrai`);
                        } else {
                            console.log(`⚠️ Bill ${bill.billNumber} not found in completed_ugrai (might have been deleted already or never existed there)`);
                        }

                        showToast('UGRAI bill approved successfully!', 'success');
                    } catch (approveError) {
                        if (approveError.code === '23505') {
                            // Duplicate key error - bill already approved
                            console.log(`✅ Bill ${bill.billNumber} already exists in approved_ugrai (duplicate key)`);
                            // Try to delete from completed_ugrai to clean up (might not exist)
                            try {
                                await this.supabaseService.removeCompletedUgrai(bill.id);
                                console.log(`✅ Cleaned up duplicate from completed_ugrai`);
                            } catch (deleteError) {
                                console.log(`⚠️ Could not delete from completed_ugrai (might already be deleted):`, deleteError.message);
                            }
                            showToast('Bill already approved (duplicate)', 'warning');
                        } else {
                            throw approveError;
                        }
                    }

                    // Remove from completed ugrai locally
                    this.data.completedUgrai.splice(billIndex, 1);
                    console.log(`🗑️ Removed bill from completedUgrai. Remaining bills: ${this.data.completedUgrai.length}`);

                    // Add to approved list for local tracking
                    if (!this.data.approvedUgrai) {
                        this.data.approvedUgrai = [];
                    }
                    this.data.approvedUgrai.push(bill);

                    // Reload UGRAI data to reflect deletion from source tables
                    console.log('🔄 Reloading UGRAI data to reflect backend changes...');
                    await this.loadUgraiData();
                    console.log(`📊 After reload, completedUgrai has ${this.data.completedUgrai.length} bills`);

                    console.log(`Ugrai bill ${billId} approved and removed from backend`);
                    showToast('UGRAI bill approved successfully!', 'success');
                }

                // Update supply bill due amount if this bill came from supply
                await this.updateSupplyBillDueAmount(bill);

                console.log('🎨 Calling renderDashboard to update UI...');
                renderDashboard();
                console.log('✅ renderDashboard completed');
                return true;

            } catch (approvalError) {
                // Handle duplicate approval error
                if (approvalError.isDuplicate) {
                    console.log('🔄 Handling duplicate approval for bill:', approvalError.billNumber);
                    console.log('📋 Removing bill from ugrai management since it was already approved');

                    // Remove from completed ugrai since it's already approved
                    this.data.completedUgrai.splice(billIndex, 1);

                    // Update UI to reflect the removal
                    renderDashboard();

                    // Show user-friendly message as requested
                    showToast('Duplicate already approved', 'warning');
                    return true; // Return true since the bill is handled (removed)
                } else {
                    // Re-throw other errors for normal error handling
                    throw approvalError;
                }
            }

        } catch (error) {
            console.error('❌ Error approving UGRAI bill:', error);
            showToast('Error approving UGRAI bill', 'error');
            return false;
        }
    }

    // Get credit bills for UGRAI conversion
    getCreditBillsForUgrai() {
        if (mockMode) {
            // In mock mode, filter from activeSupplies
            return this.data.activeSupplies.filter(bill =>
                bill.status === 'Delivered' && bill.deliveryMethod === 'Credit'
            );
        }

        // In Supabase mode, this would be handled by the service
        // For now, return filtered activeSupplies
        return this.data.activeSupplies.filter(bill =>
            bill.status === 'Delivered' && bill.deliveryMethod === 'Credit'
        );
    }

    async init() {
        if (mockMode) {
            this.initMockData();
        } else {
            try {
                // Initialize Supabase service
                this.supabaseService = new SupabaseService();

                // Load initial data
                await this.loadBills();
                await this.loadActiveSupplies();
                await this.loadApprovedBills();
                await this.loadUgraiData();

                // Setup real-time subscriptions
                this.setupSupabaseSubscriptions();

                console.log('✅ Supabase integration initialized successfully');

            } catch (error) {
                console.error('❌ Error initializing Supabase:', error);
                console.log('📝 Falling back to Firebase/local mode');

                // Keep Firebase setup for backward compatibility if needed
                this.setCollections();
                this.setupListeners();
            }
        }
    }

    // Clean up duplicate bills across all UGRAI data sources
    cleanupDuplicateUgraiBills() {
        console.log('🧹 Starting UGRAI bill cleanup to prevent ghost bills...');

        const seenBills = new Set();
        const allArrays = [
            { name: 'ugraiData', array: this.data.ugraiData },
            { name: 'ugraiEntries', array: this.data.ugraiEntries },
            { name: 'ugraiInProgress', array: this.data.ugraiInProgress },
            { name: 'availableUgraiData', array: this.data.availableUgraiData },
            { name: 'availableUgraiEntries', array: this.data.availableUgraiEntries },
            { name: 'completedUgrai', array: this.data.completedUgrai },
            { name: 'completedUgraiNew', array: this.data.completedUgraiNew }
        ];

        let duplicatesRemoved = 0;

        // First pass: collect all completed bills
        const completedBillNumbers = new Set();
        if (this.data.completedUgrai) {
            this.data.completedUgrai.forEach(bill => {
                const billNumber = bill.billNumber || bill.id;
                if (billNumber) completedBillNumbers.add(billNumber);
            });
        }
        if (this.data.completedUgraiNew) {
            this.data.completedUgraiNew.forEach(bill => {
                const billNumber = bill.billNumber || bill.id;
                if (billNumber) completedBillNumbers.add(billNumber);
            });
        }

        // Second pass: remove completed bills from all active arrays
        allArrays.forEach(({ name, array }) => {
            if (!array || name.includes('completed')) return;

            const originalLength = array.length;
            for (let i = array.length - 1; i >= 0; i--) {
                const bill = array[i];
                const billNumber = bill.billNumber || bill.id;

                if (billNumber && completedBillNumbers.has(billNumber)) {
                    console.log(`🗑️ Removing completed bill ${billNumber} from ${name}`);
                    array.splice(i, 1);
                    duplicatesRemoved++;
                }
            }

            if (array.length !== originalLength) {
                console.log(`📊 ${name}: ${originalLength} → ${array.length} bills`);
            }
        });

        // Third pass: remove duplicates within active arrays (keep only the first occurrence)
        allArrays.forEach(({ name, array }) => {
            if (!array || name.includes('completed')) return;

            const originalLength = array.length;
            for (let i = array.length - 1; i >= 0; i--) {
                const bill = array[i];
                const billNumber = bill.billNumber || bill.id;

                if (billNumber) {
                    if (seenBills.has(billNumber)) {
                        console.log(`🗑️ Removing duplicate bill ${billNumber} from ${name}`);
                        array.splice(i, 1);
                        duplicatesRemoved++;
                    } else {
                        seenBills.add(billNumber);
                    }
                }
            }

            if (array.length !== originalLength) {
                console.log(`📊 ${name}: ${originalLength} → ${array.length} bills after deduplication`);
            }
        });

        console.log(`✅ Cleanup complete: ${duplicatesRemoved} duplicate bills removed`);
        return duplicatesRemoved;
    }

    // Ensure data consistency before critical operations
    async ensureDataConsistency() {
        console.log('🔧 Ensuring data consistency...');

        // Initialize arrays if they don't exist
        if (!this.data.ugraiData) this.data.ugraiData = [];
        if (!this.data.ugraiEntries) this.data.ugraiEntries = [];
        if (!this.data.ugraiInProgress) this.data.ugraiInProgress = [];
        if (!this.data.approvedBills) this.data.approvedBills = [];
        if (!this.data.completedUgrai) this.data.completedUgrai = [];
        if (!this.data.completedUgraiNew) this.data.completedUgraiNew = [];

        // Note: Cleanup is NOT needed here because the backend SQL functions handle deletion
        // Run organization only
        await this.organizeBillsByState();

        console.log('✅ Data consistency ensured');
    }

    // Find a bill across all data sources with comprehensive search
    findBillAcrossAllSources(billId) {
        console.log(`🔍 Comprehensive search for bill: ${billId}`);

        const searchArrays = [
            { name: 'processedTotalUgrai', array: this.data.processedTotalUgrai }, // Prioritize processed data with dueAmount
            { name: 'ugraiInProgress', array: this.data.ugraiInProgress },
            { name: 'ugraiData', array: this.data.ugraiData },
            { name: 'ugraiEntries', array: this.data.ugraiEntries },
            { name: 'approvedBills', array: this.data.approvedBills }
        ];

        for (const { name, array } of searchArrays) {
            if (!array || array.length === 0) continue;

            for (let i = 0; i < array.length; i++) {
                const bill = array[i];

                // Handle approvedBills special case (only credit bills)
                if (name === 'approvedBills' && bill.deliveryMethod !== 'Credit') {
                    continue;
                }

                // Multiple comparison methods for different data types
                if (bill.id === billId || bill.billNumber === billId ||
                    bill.id == billId || bill.billNumber == billId ||
                    String(bill.id) === String(billId) ||
                    String(bill.billNumber) === String(billId)) {

                    console.log(`✅ Found bill in ${name} at index ${i}`);
                    return {
                        bill: { ...bill },
                        index: i,
                        sourceArray: name
                    };
                }
            }
        }

        // Also check if the bill might already be completed
        const completedArrays = [
            { name: 'completedUgrai', array: this.data.completedUgrai },
            { name: 'completedUgraiNew', array: this.data.completedUgraiNew }
        ];

        for (const { name, array } of completedArrays) {
            if (!array || array.length === 0) continue;

            for (let i = 0; i < array.length; i++) {
                const bill = array[i];
                if (bill.id === billId || bill.billNumber === billId ||
                    bill.id == billId || bill.billNumber == billId ||
                    String(bill.id) === String(billId) ||
                    String(bill.billNumber) === String(billId)) {

                    console.log(`ℹ️ Bill found in ${name} - already completed`);
                    return {
                        bill: null,
                        index: -1,
                        sourceArray: null,
                        alreadyCompleted: true,
                        completedBill: bill
                    };
                }
            }
        }

        console.log(`❌ Bill not found in any data source`);
        return { bill: null, index: -1, sourceArray: null };
    }

    // Automatically organize bills into proper states based on assignments
    async organizeBillsByState() {
        // console.log('📋 Organizing bills by state...');

        const assignments = this.data.ugraiAssignments || {};
        const assignedSectors = Object.keys(assignments).filter(sector =>
            assignments[sector] && assignments[sector].trim() !== ''
        );

        // Collect all unassigned bills from legacy arrays
        const unassignedBills = [];
        const assignedBills = [];

        // Process ugraiData
        if (this.data.ugraiData && this.data.ugraiData.length > 0) {
            for (let i = this.data.ugraiData.length - 1; i >= 0; i--) {
                const bill = this.data.ugraiData[i];
                if (bill.sector && assignedSectors.includes(bill.sector)) {
                    assignedBills.push(bill);
                    this.data.ugraiData.splice(i, 1);
                }
            }
        }

        // Process ugraiEntries
        if (this.data.ugraiEntries && this.data.ugraiEntries.length > 0) {
            for (let i = this.data.ugraiEntries.length - 1; i >= 0; i--) {
                const bill = this.data.ugraiEntries[i];
                if (bill.sector && assignedSectors.includes(bill.sector)) {
                    assignedBills.push(bill);
                    this.data.ugraiEntries.splice(i, 1);
                }
            }
        }

        // Move assigned bills to ugraiInProgress
        if (assignedBills.length > 0) {
            if (!this.data.ugraiInProgress) this.data.ugraiInProgress = [];

            // Add bills to In Progress, avoiding duplicates
            for (const bill of assignedBills) {
                const billNumber = bill.billNumber || bill.id;

                // Check if already exists in ugraiInProgress
                const exists = this.data.ugraiInProgress.find(existing =>
                    (existing.billNumber || existing.id) === billNumber
                );

                if (!exists) {
                    this.data.ugraiInProgress.push(bill);
                }
            }
        }

        // console.log(`📋 Organization complete: ${assignedBills.length} bills moved to In Progress`);
    }

    // UGRAI DATA MANAGEMENT - Load from Supabase and sync with cloud
    async loadUgraiData() {
        try {
            // Initialize arrays if they don't exist
            if (!this.data.ugraiData) this.data.ugraiData = [];
            if (!this.data.ugraiEntries) this.data.ugraiEntries = [];
            if (!this.data.ugraiAssignments) this.data.ugraiAssignments = {};
            if (!this.data.completedUgrai) this.data.completedUgrai = [];

            // Initialize new flow data structures
            if (!this.data.ugraiInProgress) this.data.ugraiInProgress = [];
            if (!this.data.completedUgraiNew) this.data.completedUgraiNew = [];
            if (!this.data.availableUgraiData) this.data.availableUgraiData = [];
            if (!this.data.availableUgraiEntries) this.data.availableUgraiEntries = [];

            if (mockMode || !this.supabaseService) {
                // Mock mode - data already in this.data.ugraiData
                console.log('📊 Loading UGRAI data (mock mode):', this.data.ugraiData.length, 'items');
                return;
            }

            // Supabase mode - always load fresh data from cloud for persistence
            console.log('📊 Loading fresh UGRAI data from Supabase cloud...');

            // Load all UGRAI data from cloud to ensure persistence
            const [
                ugraiData,
                ugraiEntries,
                ugraiAssignments,
                completedUgrai,
                approvedUgrai,
                ugraiInProgress,
                completedUgraiNew,
                availableUgraiData,
                availableUgraiEntries
            ] = await Promise.all([
                this.supabaseService.getUgraiData(),
                this.supabaseService.getUgraiEntries(),
                this.supabaseService.getUgraiAssignments(),
                this.supabaseService.getCompletedUgrai(),
                this.supabaseService.getAllApprovedUgrai(),
                this.supabaseService.getUgraiInProgress(),
                this.supabaseService.getCompletedUgraiNew(),
                this.supabaseService.getAvailableUgraiData(),
                this.supabaseService.getAvailableUgraiEntries()
            ]);

            // Update local data with fresh cloud data
            this.data.ugraiData = ugraiData || [];
            this.data.ugraiEntries = ugraiEntries || [];
            this.data.ugraiAssignments = ugraiAssignments || {};
            this.data.completedUgrai = completedUgrai || [];
            this.data.approvedUgrai = approvedUgrai || [];

            // Update new flow data
            this.data.ugraiInProgress = ugraiInProgress || [];
            this.data.completedUgraiNew = completedUgraiNew || [];
            this.data.availableUgraiData = availableUgraiData || [];
            this.data.availableUgraiEntries = availableUgraiEntries || [];

            console.log('📊 Fresh UGRAI data loaded from Supabase:', {
                ugraiData: this.data.ugraiData.length,
                ugraiEntries: this.data.ugraiEntries.length,
                assignments: Object.keys(this.data.ugraiAssignments).length,
                completed: this.data.completedUgrai.length,
                approved: this.data.approvedUgrai.length,
                // New flow data
                inProgress: this.data.ugraiInProgress.length,
                completedNew: this.data.completedUgraiNew.length,
                availableData: this.data.availableUgraiData.length,
                availableEntries: this.data.availableUgraiEntries.length
            });

            // Note: Cleanup is NOT needed on data load because the backend SQL functions
            // (complete_ugrai_bill and approve_ugrai_bills) already handle deletion from source tables
            // The database is the source of truth - we just display what's there

            // Organize bills into proper states
            await this.organizeBillsByState();

            renderDashboard();
        } catch (error) {
            console.error('❌ Error loading UGRAI data:', error);
            showToast('Error loading UGRAI data', 'error');

            // Initialize empty arrays as fallback
            if (!this.data.ugraiData) this.data.ugraiData = [];
            if (!this.data.ugraiEntries) this.data.ugraiEntries = [];
            if (!this.data.ugraiAssignments) this.data.ugraiAssignments = {};
            if (!this.data.completedUgrai) this.data.completedUgrai = [];
        }
    }

    async replaceUgraiData(ugraiItems) {
        try {
            if (mockMode) {
                this.data.ugraiData = ugraiItems;
                renderDashboard();
                return;
            }

            // Supabase mode
            await this.supabaseService.replaceUgraiData(ugraiItems);
            this.data.ugraiData = ugraiItems;
            renderDashboard();

            console.log('✅ UGRAI data replaced successfully');
        } catch (error) {
            console.error('❌ Error replacing UGRAI data:', error);
            throw error;
        }
    }

    async addUgraiData(ugraiItems) {
        try {
            if (mockMode || !this.supabaseService) {
                // In mock mode, replace existing data instead of adding to prevent duplicates
                this.data.ugraiData = ugraiItems;
                renderDashboard();
                console.log(`Set ${ugraiItems.length} UGRAI items (mock/local mode)`);
                return;
            }

            // Supabase mode - upsert items to database (handles duplicates)
            const results = await this.supabaseService.addUgraiData(ugraiItems);

            // Reload all data from database to get the current state
            await this.loadUgraiData();

            console.log(`✅ Added/Updated ${ugraiItems.length} UGRAI items to Supabase`);
            showToast(`${ugraiItems.length} UGRAI records saved successfully!`, 'success');
        } catch (error) {
            console.error('❌ Error adding UGRAI data:', error);
            showToast('Error saving UGRAI data to database', 'error');

            // Fallback to local storage
            console.log('📝 Falling back to local storage');
            this.data.ugraiData = ugraiItems;
            renderDashboard();
        }
    }

    // FIXED: Define setUgraiData as a proper method in the class (for replacement)
    setUgraiData(ugraiData) {
        console.log("Setting Ugrai data (REPLACING existing data):", ugraiData);
        this.data.ugraiData = ugraiData; // Direct replacement
        renderDashboard();
        return;
    }

    async addUgraiEntry(creditBill) {
        try {
            const ugraiEntry = {
                id: `UG-${creditBill.billNumber}`,
                billNumber: creditBill.billNumber,
                billDate: creditBill.billDate,
                retailerName: creditBill.retailerName,
                sector: creditBill.sector,
                netAmount: creditBill.netAmount,
                status: 'Pending',
                assignedTo: null,
                originalSupplyId: creditBill.id
            };

            if (mockMode) {
                this.data.ugraiEntries.push(ugraiEntry);
                renderDashboard();
                return ugraiEntry;
            }

            // Supabase mode
            const result = await this.supabaseService.addUgraiEntry(ugraiEntry);
            this.data.ugraiEntries.push({ ...ugraiEntry, id: result.id });
            renderDashboard();

            return result;
        } catch (error) {
            console.error('❌ Error adding UGRAI entry:', error);
            throw error;
        }
    }

    async saveUgraiAssignments(assignments) {
        try {
            if (mockMode) {
                this.data.ugraiAssignments = assignments;
                renderDashboard();
                return;
            }

            // Supabase mode
            await this.supabaseService.saveUgraiAssignments(assignments);
            this.data.ugraiAssignments = assignments;
            renderDashboard();

            console.log('✅ UGRAI assignments saved successfully');
        } catch (error) {
            console.error('❌ Error saving UGRAI assignments:', error);
            throw error;
        }
    }

    // FIXED: Define addUgraiEntries as a proper method
    async addUgraiEntries(entries) {
        try {
            if (mockMode) {
                // Add IDs to entries
                entries.forEach(entry => {
                    entry.id = entry.id || `UG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
                });

                // Add to ugraiEntries
                this.data.ugraiEntries = [...this.data.ugraiEntries, ...entries];
                renderDashboard();
                return;
            }

            // Supabase mode - add entries to database
            const results = [];
            for (const entry of entries) {
                const result = await this.supabaseService.addUgraiEntry(entry);
                results.push(result);
            }

            // Update local data
            this.data.ugraiEntries = [...this.data.ugraiEntries, ...results];
            renderDashboard();

            console.log(`✅ Added ${entries.length} UGRAI entries to Supabase`);
        } catch (error) {
            console.error('❌ Error adding UGRAI entries:', error);
            showToast('Error saving UGRAI entries to database', 'error');
            throw error;
        }
    }

    // NEW UGRAI FLOW METHODS

    // Move UGRAI bills to In Progress stage
    async moveUgraiToInProgress(sourceTable, billIds, assignedTo) {
        try {
            if (mockMode || !this.supabaseService) {
                // Mock mode - simulate moving bills
                console.log(`📋 Mock: Moving ${billIds.length} bills from ${sourceTable} to in progress`);

                // Find bills from source
                const sourceData = sourceTable === 'ugrai_data' ? this.data.ugraiData : this.data.ugraiEntries;
                const billsToMove = sourceData.filter(bill => billIds.includes(bill.id));

                // Add to in progress (simulate)
                if (!this.data.ugraiInProgress) this.data.ugraiInProgress = [];
                const inProgressBills = billsToMove.map(bill => ({
                    ...bill,
                    assignedTo,
                    assignedDate: new Date().toISOString(),
                    sourceTable,
                    sourceId: bill.id
                }));

                this.data.ugraiInProgress.push(...inProgressBills);

                // Update source status
                billsToMove.forEach(bill => bill.currentStage = 'in_progress');

                renderDashboard();
                return billIds.length;
            }

            const movedCount = await this.supabaseService.moveUgraiToInProgress(sourceTable, billIds, assignedTo);

            // Reload data
            await this.loadUgraiInProgress();

            showToast(`${movedCount} bills moved to in progress`, 'success');
            return movedCount;

        } catch (error) {
            console.error('❌ Error moving UGRAI to in progress:', error);
            showToast('Error moving bills to in progress', 'error');
            throw error;
        }
    }

    // Load UGRAI bills in progress
    async loadUgraiInProgress() {
        try {
            if (mockMode || !this.supabaseService) {
                // Mock mode - use local data
                this.data.ugraiInProgress = this.data.ugraiInProgress || [];
                return;
            }

            const inProgressBills = await this.supabaseService.getUgraiInProgress();
            this.data.ugraiInProgress = inProgressBills;

            console.log(`✅ Loaded ${inProgressBills.length} UGRAI bills in progress`);

        } catch (error) {
            console.error('❌ Error loading UGRAI in progress:', error);
            this.data.ugraiInProgress = [];
        }
    }

    // Complete UGRAI bill using new flow
    async completeUgraiBillNew(billNumber, completionData) {
        try {
            if (mockMode || !this.supabaseService) {
                // Mock mode - simulate completion
                console.log(`✅ Mock: Completing UGRAI bill ${billNumber}`);

                // Find bill in progress
                const inProgressIndex = this.data.ugraiInProgress?.findIndex(bill => bill.billNumber === billNumber);
                if (inProgressIndex === -1) {
                    throw new Error('Bill not found in progress');
                }

                const bill = this.data.ugraiInProgress[inProgressIndex];

                // Move to completed
                if (!this.data.completedUgraiNew) this.data.completedUgraiNew = [];
                this.data.completedUgraiNew.push({
                    ...bill,
                    ...completionData,
                    completedDate: new Date().toISOString()
                });

                // Remove from in progress
                this.data.ugraiInProgress.splice(inProgressIndex, 1);

                renderDashboard();
                return true;
            }

            const completedId = await this.supabaseService.completeUgraiBillNew(billNumber, completionData);

            // Reload data
            await this.loadUgraiInProgress();
            await this.loadCompletedUgraiNew();
            await this.loadUgraiDataOnly();
            await this.loadUgraiEntriesOnly();

            showToast('UGRAI bill completed successfully', 'success');
            return completedId;

        } catch (error) {
            console.error('❌ Error completing UGRAI bill:', error);
            showToast('Error completing UGRAI bill', 'error');
            throw error;
        }
    }

    // Load completed UGRAI bills (new flow)
    async loadCompletedUgraiNew() {
        try {
            if (mockMode || !this.supabaseService) {
                // Mock mode - use local data
                this.data.completedUgraiNew = this.data.completedUgraiNew || [];
                return;
            }

            const completedBills = await this.supabaseService.getCompletedUgraiNew();
            this.data.completedUgraiNew = completedBills;

            console.log(`✅ Loaded ${completedBills.length} completed UGRAI bills`);

        } catch (error) {
            console.error('❌ Error loading completed UGRAI:', error);
            this.data.completedUgraiNew = [];
        }
    }

    // Load available UGRAI bills (not in progress)
    async loadAvailableUgraiData() {
        try {
            if (mockMode || !this.supabaseService) {
                // Mock mode - filter local data
                this.data.availableUgraiData = (this.data.ugraiData || []).filter(
                    bill => !bill.currentStage || bill.currentStage === 'available'
                );
                this.data.availableUgraiEntries = (this.data.ugraiEntries || []).filter(
                    bill => !bill.currentStage || bill.currentStage === 'available'
                );
                return;
            }

            const [availableData, availableEntries] = await Promise.all([
                this.supabaseService.getAvailableUgraiData(),
                this.supabaseService.getAvailableUgraiEntries()
            ]);

            this.data.availableUgraiData = availableData;
            this.data.availableUgraiEntries = availableEntries;

            console.log(`✅ Loaded ${availableData.length} available UGRAI data and ${availableEntries.length} entries`);

        } catch (error) {
            console.error('❌ Error loading available UGRAI data:', error);
            this.data.availableUgraiData = [];
            this.data.availableUgraiEntries = [];
        }
    }

    initMockData() {
        this.data.retailers = [
            { id: '1', name: 'Gupta Store', sector: 'Retail' },
            { id: '2', name: 'Punjab Store', sector: 'Wholesale' },
            { id: '3', name: 'Delhi Electronics', sector: 'Electronics' },
            { id: '4', name: 'Mumbai Beauty', sector: 'Cosmetics' }
        ];

        // Create some mock approved credit bills
        if (!this.data.approvedBills) {
            this.data.approvedBills = [
                {
                    id: 'credit-1',
                    billNumber: 'CRED-1001',
                    billDate: '2023-09-15',
                    retailerName: 'Gupta Store',
                    sector: 'Retail',
                    netAmount: 5000,
                    deliveryMethod: 'Credit',
                    status: 'Delivered'
                },
                {
                    id: 'credit-2',
                    billNumber: 'CRED-1002',
                    billDate: '2023-09-16',
                    retailerName: 'Punjab Store',
                    sector: 'Wholesale',
                    netAmount: 7500,
                    deliveryMethod: 'Credit',
                    status: 'Delivered'
                }
            ];
        }

        renderDashboard();
    }
    setCollections() {
        this.collections = {
            temporaryBills: collection(db, `artifacts/${appId}/users/${userId}/temporaryBills`),
            retailers: collection(db, `artifacts/${appId}/users/${userId}/retailers`),
            bills: collection(db, `artifacts/${appId}/users/${userId}/bills`),
            activeSupplies: collection(db, `artifacts/${appId}/users/${userId}/activeSupplies`),
            approvedBills: collection(db, `artifacts/${appId}/users/${userId}/approvedBills`),
            editedBills: collection(db, `artifacts/${appId}/users/${userId}/editedBills`),
            purchaseRetailers: collection(db, `artifacts/${appId}/users/${userId}/purchaseRetailers`),
            purchaseEntries: collection(db, `artifacts/${appId}/users/${userId}/purchaseEntries`)
        };
    }

    setupListeners() {
        onSnapshot(this.collections.temporaryBills, (snapshot) => {
            this.data.temporaryBills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.data.temporaryBills.sort((a, b) => a.brand.localeCompare(b.brand));
            renderDashboard();
        });
        onSnapshot(this.collections.retailers, (snapshot) => {
            this.data.retailers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderDashboard();
        });
        onSnapshot(this.collections.bills, (snapshot) => {
            this.data.bills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderDashboard();
        });
        onSnapshot(this.collections.activeSupplies, (snapshot) => {
            this.data.activeSupplies = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderDashboard();
        });
        onSnapshot(this.collections.approvedBills, (snapshot) => {
            this.data.approvedBills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderDashboard();
        });
        onSnapshot(this.collections.editedBills, (snapshot) => {
            this.data.editedBills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderDashboard();
        });
        onSnapshot(this.collections.purchaseRetailers, (snapshot) => {
            this.data.purchaseRetailers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderDashboard();
        });
        onSnapshot(this.collections.purchaseEntries, (snapshot) => {
            this.data.purchaseEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderDashboard();
        });
    }

    setupSupabaseSubscriptions() {
        if (mockMode) {
            console.log('Mock mode: Skipping real-time subscriptions');
            return;
        }

        console.log('Setting up Supabase real-time subscriptions...');

        // Subscribe to all data changes
        this.supabaseService.subscribeToBills((payload) => {
            console.log('Bills changed:', payload);
            this.loadBills();
        });

        this.supabaseService.subscribeToActiveSupplies((payload) => {
            console.log('Active supplies changed:', payload);
            this.loadActiveSupplies();
        });

        this.supabaseService.subscribeToApprovedBills((payload) => {
            console.log('Approved bills changed:', payload);
            this.loadApprovedBills();
        });

        // UGRAI subscriptions - handle incremental updates instead of full reloads
        this.supabaseService.subscribeToUgraiData((payload) => {
            console.log('UGRAI data changed:', payload);
            this.handleUgraiDataUpdate(payload);
        });

        this.supabaseService.subscribeToUgraiEntries((payload) => {
            console.log('UGRAI entries changed:', payload);
            this.handleUgraiEntriesUpdate(payload);
        });

        this.supabaseService.subscribeToCompletedUgrai((payload) => {
            console.log('🔔 COMPLETED UGRAI SUBSCRIPTION TRIGGERED:', {
                eventType: payload.eventType,
                billNumber: payload.new?.bill_number || payload.old?.bill_number,
                recordId: payload.new?.id || payload.old?.id,
                timestamp: new Date().toISOString()
            });
            this.handleCompletedUgraiUpdate(payload);
        });

        this.supabaseService.subscribeToUgraiAssignments((payload) => {
            console.log('UGRAI assignments changed:', payload);
            this.handleUgraiAssignmentsUpdate(payload);
        });
    }

    // Handle incremental UGRAI data updates
    handleUgraiDataUpdate(payload) {
        try {
            // Google Sheets edition: realtime is polling based and sends a 'SYNC' signal -> reload the table
            if (payload && payload.eventType === 'SYNC') {
                if (typeof this.loadUgraiDataOnly === 'function') this.loadUgraiDataOnly();
                return;
            }
            const { eventType, new: newRecord, old: oldRecord } = payload;

            switch (eventType) {
                case 'INSERT':
                    if (newRecord) {
                        const transformedRecord = this.transformFromSupabaseUgrai(newRecord);
                        this.data.ugraiData.push(transformedRecord);
                    }
                    break;
                case 'UPDATE':
                    if (newRecord) {
                        const index = this.data.ugraiData.findIndex(item => item.id === newRecord.id);
                        if (index !== -1) {
                            this.data.ugraiData[index] = this.transformFromSupabaseUgrai(newRecord);
                        }
                    }
                    break;
                case 'DELETE':
                    if (oldRecord) {
                        this.data.ugraiData = this.data.ugraiData.filter(item => item.id !== oldRecord.id);
                    }
                    break;
            }
            renderDashboard();
        } catch (error) {
            console.error('Error handling UGRAI data update:', error);
        }
    }

    handleUgraiEntriesUpdate(payload) {
        try {
            // Google Sheets edition: realtime is polling based and sends a 'SYNC' signal -> reload the table
            if (payload && payload.eventType === 'SYNC') {
                if (typeof this.loadUgraiEntriesOnly === 'function') this.loadUgraiEntriesOnly();
                return;
            }
            const { eventType, new: newRecord, old: oldRecord } = payload;

            switch (eventType) {
                case 'INSERT':
                    if (newRecord) {
                        const transformedRecord = this.transformFromSupabaseUgrai(newRecord);
                        this.data.ugraiEntries.push(transformedRecord);
                    }
                    break;
                case 'UPDATE':
                    if (newRecord) {
                        const index = this.data.ugraiEntries.findIndex(item => item.id === newRecord.id);
                        if (index !== -1) {
                            this.data.ugraiEntries[index] = this.transformFromSupabaseUgrai(newRecord);
                        }
                    }
                    break;
                case 'DELETE':
                    if (oldRecord) {
                        this.data.ugraiEntries = this.data.ugraiEntries.filter(item => item.id !== oldRecord.id);
                    }
                    break;
            }
            renderDashboard();
        } catch (error) {
            console.error('Error handling UGRAI entries update:', error);
        }
    }

    handleCompletedUgraiUpdate(payload) {
        try {
            // Google Sheets edition: realtime is polling based and sends a 'SYNC' signal -> reload the table
            if (payload && payload.eventType === 'SYNC') {
                if (typeof this.loadCompletedUgraiOnly === 'function') this.loadCompletedUgraiOnly();
                return;
            }
            const { eventType, new: newRecord, old: oldRecord } = payload;
            console.log('📥 Processing completed UGRAI update:', eventType, newRecord?.bill_number || oldRecord?.bill_number);

            switch (eventType) {
                case 'INSERT':
                    if (newRecord) {
                        const transformedRecord = this.transformFromSupabaseUgrai(newRecord);
                        // Check if this record already exists to prevent duplicates
                        const existingIndex = this.data.completedUgrai.findIndex(item =>
                            item.id === newRecord.id ||
                            (item.billNumber === transformedRecord.billNumber && item.billNumber)
                        );
                        if (existingIndex === -1) {
                            this.data.completedUgrai.push(transformedRecord);
                            console.log('✅ Added completed UGRAI to local data:', transformedRecord.billNumber, '| Total:', this.data.completedUgrai.length);
                        } else {
                            console.log('⚠️ Completed UGRAI already exists, skipping:', transformedRecord.billNumber);
                        }
                    }
                    break;
                case 'UPDATE':
                    if (newRecord) {
                        const transformedRecord = this.transformFromSupabaseUgrai(newRecord);
                        const index = this.data.completedUgrai.findIndex(item => item.id === newRecord.id);
                        if (index !== -1) {
                            this.data.completedUgrai[index] = transformedRecord;
                            console.log('🔄 Subscription: Updated completed UGRAI in local data:', newRecord.bill_number, '| Total:', this.data.completedUgrai.length);
                        } else {
                            // If not found by ID, try to find by bill number and add
                            const billNumberIndex = this.data.completedUgrai.findIndex(item => item.billNumber === transformedRecord.billNumber);
                            if (billNumberIndex !== -1) {
                                this.data.completedUgrai[billNumberIndex] = transformedRecord;
                                console.log('🔄 Subscription: Updated completed UGRAI by bill number:', transformedRecord.billNumber);
                            } else {
                                // Add as new record if not found
                                this.data.completedUgrai.push(transformedRecord);
                                console.log('✅ Subscription: Added new completed UGRAI from UPDATE event:', transformedRecord.billNumber, '| Total:', this.data.completedUgrai.length);
                            }
                        }
                    }
                    break;
                case 'DELETE':
                    if (oldRecord) {
                        const beforeCount = this.data.completedUgrai.length;
                        this.data.completedUgrai = this.data.completedUgrai.filter(item => item.id !== oldRecord.id);
                        console.log('🗑️ Removed completed UGRAI from local data:', oldRecord.bill_number, '| Count:', beforeCount, '->', this.data.completedUgrai.length);
                    }
                    break;
            }
            renderDashboard();
        } catch (error) {
            console.error('❌ Error handling completed UGRAI update:', error);
        }
    }

    handleUgraiAssignmentsUpdate(payload) {
        try {
            // For assignments, we can do a targeted reload since it's just assignment data
            this.loadUgraiAssignments();
        } catch (error) {
            console.error('Error handling UGRAI assignments update:', error);
        }
    }

    // Transform Supabase UGRAI record to local format
    transformFromSupabaseUgrai(record) {
        return {
            id: record.id,
            billNumber: record.bill_number,
            billDate: record.bill_date,
            retailerName: record.retailer_name,
            sector: record.sector,
            netAmount: record.net_amount,
            paymentMethod: record.payment_method,
            receiptNumber: record.receipt_number,
            receivedAmount: record.received_amount,
            chequeDate: record.cheque_date,
            photoUploaded: record.photo_uploaded,
            dateCompleted: record.date_completed,
            assignedTo: record.assigned_to,
            status: record.status
        };
    }

    // Load only UGRAI assignments (smaller dataset)
    async loadUgraiAssignments() {
        try {
            if (mockMode || !this.supabaseService) return;

            const assignments = await this.supabaseService.getUgraiAssignments();
            this.data.ugraiAssignments = assignments || {};
            renderDashboard();
        } catch (error) {
            console.error('❌ Error loading UGRAI assignments:', error);
        }
    }

    // Method to manually refresh completed UGRAI data for debugging
    async refreshCompletedUgraiData() {
        try {
            if (mockMode || !this.supabaseService) {
                console.log('🔍 Mock mode - completed UGRAI count:', this.data.completedUgrai?.length || 0);
                return this.data.completedUgrai || [];
            }

            console.log('🔄 Manually refreshing completed UGRAI data from Supabase...');
            const completedUgrai = await this.supabaseService.getCompletedUgrai();
            this.data.completedUgrai = completedUgrai || [];

            console.log('✅ Refreshed completed UGRAI data:', this.data.completedUgrai.length, 'items');
            renderDashboard();

            return this.data.completedUgrai;
        } catch (error) {
            console.error('❌ Error refreshing completed UGRAI data:', error);
            return [];
        }
    }

    // Method to clean up ghost bills (already approved bills in local arrays)
    // WARNING: This can be slow - only call when explicitly needed
    async cleanupGhostBills() {
        try {
            if (mockMode || !this.supabaseService) {
                console.log('📝 Mock mode - no ghost bill cleanup needed');
                return { removed: 0, checked: 0 };
            }

            // Check if we're currently in supply context - if so, skip cleanup
            const currentProcess = document.querySelector('.process-btn.active')?.dataset?.process;
            if (currentProcess !== 'ugrai') {
                console.log('⚠️ Skipping ghost bill cleanup - not in UGRAI context (current:', currentProcess, ')');
                return { removed: 0, checked: 0, skipped: true };
            }

            console.log('👻 Starting ghost bill cleanup...');
            let totalRemoved = 0;
            let totalChecked = 0;

            // Check ugraiData for ghost bills
            if (this.data.ugraiData && this.data.ugraiData.length > 0) {
                const originalCount = this.data.ugraiData.length;
                const cleanedData = [];

                for (const bill of this.data.ugraiData) {
                    totalChecked++;
                    const isApproved = await this.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);
                    if (!isApproved) {
                        cleanedData.push(bill);
                    } else {
                        totalRemoved++;
                        console.log('👻 Removing ghost bill from ugraiData and database:', bill.billNumber, '(approved on', isApproved.date_approved, ')');

                        // Remove from database as well
                        try {
                            if (bill.id) {
                                await this.supabaseService.removeUgraiDataById(bill.id);
                            } else if (bill.billNumber) {
                                await this.supabaseService.removeUgraiDataByBillNumber(bill.billNumber);
                            }
                        } catch (dbError) {
                            console.warn('⚠️ Could not remove ghost bill from database:', bill.billNumber, dbError);
                        }
                    }
                }

                this.data.ugraiData = cleanedData;
                console.log('✅ Cleaned ugraiData:', originalCount, '->', cleanedData.length);
            }

            // Check ugraiEntries for ghost bills
            if (this.data.ugraiEntries && this.data.ugraiEntries.length > 0) {
                const originalCount = this.data.ugraiEntries.length;
                const cleanedEntries = [];

                for (const bill of this.data.ugraiEntries) {
                    totalChecked++;
                    const isApproved = await this.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);
                    if (!isApproved) {
                        cleanedEntries.push(bill);
                    } else {
                        totalRemoved++;
                        console.log('👻 Removing ghost bill from ugraiEntries and database:', bill.billNumber, '(approved on', isApproved.date_approved, ')');

                        // Remove from database as well
                        try {
                            if (bill.id) {
                                await this.supabaseService.removeUgraiEntryById(bill.id);
                            } else if (bill.billNumber) {
                                await this.supabaseService.removeUgraiEntryByBillNumber(bill.billNumber);
                            }
                        } catch (dbError) {
                            console.warn('⚠️ Could not remove ghost bill from database:', bill.billNumber, dbError);
                        }
                    }
                }

                this.data.ugraiEntries = cleanedEntries;
                console.log('✅ Cleaned ugraiEntries:', originalCount, '->', cleanedEntries.length);
            }

            // Check completedUgrai for ghost bills
            if (this.data.completedUgrai && this.data.completedUgrai.length > 0) {
                const originalCount = this.data.completedUgrai.length;
                const cleanedCompleted = [];

                for (const bill of this.data.completedUgrai) {
                    totalChecked++;
                    const isApproved = await this.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);
                    if (!isApproved) {
                        cleanedCompleted.push(bill);
                    } else {
                        totalRemoved++;
                        console.log('👻 Removed ghost bill from completedUgrai:', bill.billNumber, '(approved on', isApproved.date_approved, ')');
                    }
                }

                this.data.completedUgrai = cleanedCompleted;
                console.log('✅ Cleaned completedUgrai:', originalCount, '->', cleanedCompleted.length);
            }

            renderDashboard();

            // Also refresh the UGRAI In Progress table to remove ghost bills from display
            if (typeof renderAssignedUgraiBillsTable === 'function') {
                try {
                    await renderAssignedUgraiBillsTable();
                } catch (error) {
                    console.warn('⚠️ Could not refresh UGRAI In Progress table:', error);
                    // Fall back to sync version
                    renderAssignedUgraiBillsTableSync();
                }
            }

            console.log(`✅ Ghost bill cleanup complete: Removed ${totalRemoved} ghost bills out of ${totalChecked} checked`);
            showToast(`Cleaned up ${totalRemoved} ghost bills`, 'success');

            return { removed: totalRemoved, checked: totalChecked };
        } catch (error) {
            console.error('❌ Error cleaning up ghost bills:', error);
            showToast('Error cleaning up ghost bills', 'error');
            return { removed: 0, checked: 0 };
        }
    }

    // Update supply bill due amount when ugrai is approved
    async updateSupplyBillDueAmount(approvedBill) {
        try {
            // Check if this bill came from a supply bill
            if (!approvedBill.originalSupplyBillId && !approvedBill.sourceType) {
                console.log('ℹ️ Bill did not originate from supply, skipping due amount update');
                return;
            }

            const originalSupplyBillId = approvedBill.originalSupplyBillId;
            const approvedAmount = parseFloat(approvedBill.receivedAmount || approvedBill.netAmount || 0);

            console.log('💰 Updating supply bill due amount for originalSupplyBillId:', originalSupplyBillId, 'approved amount:', approvedAmount);

            if (!this.data.approvedBills || this.data.approvedBills.length === 0) {
                console.log('⚠️ No approved bills (supply bills) found to update');
                return;
            }

            // Find the original supply bill
            const supplyBillIndex = this.data.approvedBills.findIndex(bill =>
                bill.id == originalSupplyBillId && bill.deliveryMethod === 'Credit'
            );

            if (supplyBillIndex === -1) {
                console.log('⚠️ Original supply bill not found with ID:', originalSupplyBillId);
                return;
            }

            const supplyBill = this.data.approvedBills[supplyBillIndex];
            const currentDueAmount = parseFloat(supplyBill.dueAmount || 0);
            const newDueAmount = Math.max(0, currentDueAmount - approvedAmount);

            console.log('📊 Supply bill due amount update:', {
                billNumber: supplyBill.billNumber,
                currentDue: currentDueAmount,
                approvedAmount: approvedAmount,
                newDue: newDueAmount
            });

            // Update the due amount
            this.data.approvedBills[supplyBillIndex].dueAmount = newDueAmount;

            // If due amount is 0, remove the bill from supply
            if (newDueAmount === 0) {
                console.log('✅ Supply bill fully paid, removing from supply list:', supplyBill.billNumber);
                this.data.approvedBills.splice(supplyBillIndex, 1);

                // Update in Supabase if not in mock mode
                if (!mockMode && this.supabaseService) {
                    try {
                        // Mark as fully paid or remove from supply table
                        await this.supabaseService.updateBill(originalSupplyBillId, {
                            dueAmount: 0,
                            status: 'Fully Paid',
                            dateFullyPaid: new Date().toISOString().split('T')[0]
                        });
                    } catch (error) {
                        console.error('❌ Error updating supply bill in database:', error);
                    }
                }

                showToast(`Supply bill ${supplyBill.billNumber} fully paid and removed`, 'success');
            } else {
                // Update due amount in Supabase if not in mock mode
                if (!mockMode && this.supabaseService) {
                    try {
                        await this.supabaseService.updateBill(originalSupplyBillId, {
                            dueAmount: newDueAmount
                        });
                    } catch (error) {
                        console.error('❌ Error updating supply bill due amount in database:', error);
                    }
                }

                showToast(`Supply bill ${supplyBill.billNumber} due amount updated to ₹${newDueAmount.toFixed(2)}`, 'info');
            }

        } catch (error) {
            console.error('❌ Error updating supply bill due amount:', error);
            showToast('Error updating supply bill due amount', 'error');
        }
    }

    // Update supply status method
    async updateSupplyStatus(billNumber, updates) {
        try {
            if (mockMode) {
                const billIndex = this.data.activeSupplies.findIndex(bill => bill.billNumber === billNumber);
                if (billIndex !== -1) {
                    const bill = { ...this.data.activeSupplies[billIndex] };

                    // Apply updates
                    Object.assign(bill, updates);

                    // Remove from active supplies (in progress)
                    this.data.activeSupplies.splice(billIndex, 1);

                    // If status is 'Edited', move to editedBills array instead of activeSupplies
                    if (updates.status === 'Edited') {
                        this.data.editedBills.push({
                            ...bill,
                            editedAmount: bill.netAmount, // Keep original amount as reference
                            originalAmount: bill.netAmount
                        });
                        console.log(`Bill ${billNumber} moved to edited bills for supply management`);
                        showToast('Bill marked as edited and moved to edited bills section');
                    } else {
                        // ALL other submitted forms go back to activeSupplies for approval
                        this.data.activeSupplies.push(bill);
                    }

                    renderDashboard();
                    console.log(`Bill ${billNumber} status updated to ${updates.status}`);
                } else {
                    showToast('Bill not found');
                }
                return;
            }

            // Supabase implementation
            try {
                const { data: bills, error } = await this.supabaseService.getActiveSupplies();
                if (error) throw error;

                const bill = bills.find(b => b.billNumber === billNumber);
                if (bill) {
                    if (updates.status === 'Edited') {
                        // Ensure retailer_name is set
                        if (!bill.retailer_name) {
                            bill.retailer_name = bill.retailerName || bill.retailer || 'Unknown';
                        }
                        // Save to edited_bills table in database
                        await this.supabaseService.addEditedBill(
                            bill,
                            bill.netAmount,
                            bill.netAmount,
                            'Bill marked as edited for correction'
                        );
                        // Remove from active_supplies table (no longer active)
                        await this.supabaseService.removeActiveSupply(bill.id);
                        // Move to edited bills in local data with additional tracking fields
                        const localBillIndex = this.data.activeSupplies.findIndex(b => b.billNumber === billNumber);
                        if (localBillIndex !== -1) {
                            const localBill = this.data.activeSupplies[localBillIndex];
                            this.data.activeSupplies.splice(localBillIndex, 1);
                            this.data.editedBills.push({
                                ...localBill,
                                ...updates,
                                editedAmount: localBill.netAmount,
                                originalAmount: localBill.netAmount
                            });
                        }
                        console.log(`Bill ${billNumber} moved to edited bills for supply management`);
                        showToast('Bill marked as edited and moved to edited bills section', 'success');
                    } else {
                        // Normal update for other statuses
                        console.log(`🔄 Attempting to update bill ${bill.id} with status ${updates.status}...`);
                        const updateResult = await this.supabaseService.updateActiveSupply(bill.id, updates);
                        console.log(`📝 Update result:`, updateResult);

                        if (updateResult && updateResult.error) {
                            console.error('❌ Database update failed:', updateResult.error);
                            showToast(`Error: ${updateResult.error.message || 'Failed to update bill'}`, 'error');
                            return;
                        }

                        // Reload active supplies data from database to reflect the change
                        const { data: updatedBills, error: reloadError } = await this.supabaseService.getActiveSupplies();
                        if (!reloadError && updatedBills) {
                            this.data.activeSupplies = updatedBills;
                            console.log(`✅ Reloaded ${updatedBills.length} active supplies after status update`);

                            // Verify the update worked
                            const updatedBill = updatedBills.find(b => b.billNumber === billNumber);
                            if (updatedBill) {
                                console.log(`✅ Bill ${billNumber} status in DB: ${updatedBill.status}`);
                            }
                        } else if (reloadError) {
                            console.error('❌ Error reloading active supplies:', reloadError);
                        }
                    }

                    renderDashboard();
                    console.log(`Bill ${billNumber} status updated to ${updates.status}`);
                } else {
                    showToast('Bill not found');
                }
            } catch (error) {
                console.error('Error updating supply status in Supabase:', error);
                showToast('Error updating supply status');
            }
        } catch (e) {
            showToast("Error updating supply status");
            console.error("Error updating supply status:", e);
        }
    }
    // ADD THE NEW METHOD HERE
    async updateBillInPlace(billNumber, updates) {
        try {
            if (mockMode) {
                const billIndex = this.data.activeSupplies.findIndex(bill => bill.billNumber === billNumber);
                if (billIndex !== -1) {
                    const bill = this.data.activeSupplies[billIndex];

                    // If the status is being updated to 'Edited', move the bill to editedBills array
                    if (updates.status === 'Edited') {
                        // Update the bill with new data
                        Object.assign(bill, updates);

                        // Remove from activeSupplies
                        this.data.activeSupplies.splice(billIndex, 1);

                        // Add to editedBills array
                        const editedBill = {
                            ...bill,
                            editedAmount: bill.netAmount, // Keep original amount as reference
                            originalAmount: bill.netAmount
                        };
                        this.data.editedBills.push(editedBill);

                        console.log(`Bill ${billNumber} moved to edited bills array:`, editedBill);
                        console.log('Current edited bills array:', this.data.editedBills);
                        showToast('Bill marked as edited and moved to edited bills section', 'success');
                    } else {
                        // Normal update without moving
                        Object.assign(bill, updates);
                    }

                    renderDashboard();
                    console.log(`Bill ${billNumber} updated in place with:`, updates);
                } else {
                    showToast('Bill not found');
                }
                return;
            }

            // Supabase implementation
            try {
                // First check local data for the bill
                const localBillIndex = this.data.activeSupplies.findIndex(b => b.billNumber === billNumber);
                if (localBillIndex !== -1) {
                    const localBill = this.data.activeSupplies[localBillIndex];

                    if (updates.status === 'Edited') {
                        // Save to edited_bills table in database
                        await this.supabaseService.addEditedBill(
                            localBill,
                            localBill.netAmount,
                            localBill.netAmount,
                            'Bill marked as edited for correction'
                        );

                        // Remove from active_supplies table (no longer active)
                        await this.supabaseService.removeActiveSupply(localBill.id);

                        // Move to edited bills in local data with additional tracking fields
                        this.data.activeSupplies.splice(localBillIndex, 1);
                        const editedBill = {
                            ...localBill,
                            ...updates,
                            editedAmount: localBill.netAmount,
                            originalAmount: localBill.netAmount
                        };
                        this.data.editedBills.push(editedBill);

                        console.log(`Bill ${billNumber} moved to edited bills array:`, editedBill);
                        console.log('Current edited bills array:', this.data.editedBills);
                        showToast('Bill marked as edited and moved to edited bills section', 'success');
                    } else {
                        // Normal update
                        await this.supabaseService.updateActiveSupply(localBill.id, updates);
                        Object.assign(localBill, updates);
                        showToast('Bill updated successfully', 'success');
                    }

                    renderDashboard();
                    console.log(`Bill ${billNumber} updated in place with:`, updates);
                } else {
                    console.error(`Bill ${billNumber} not found in local data`);
                    showToast('Bill not found', 'error');
                }
            } catch (error) {
                console.error('Error updating bill in Supabase:', error);
                showToast('Error updating bill', 'error');
            }
        } catch (e) {
            showToast("Error updating bill");
            console.error("Error updating bill in place:", e);
        }
    }


    async addTemporaryBill(bill) {
        try {
            if (mockMode) {
                bill.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
                this.data.temporaryBills.push(bill);
                renderDashboard();
                showToast('Bill added to staging area!');
                return;
            }

            await addDoc(this.collections.temporaryBills, bill);
            showToast('Bill added to staging area!');
        } catch (e) {
            showToast("Error adding temporary bill");
            console.error("Error adding document: ", e);
        }
    }

    async addActiveSupply(bill) {
        try {
            if (mockMode) {
                // Generate ID if not present
                if (!bill.id) {
                    bill.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
                }
                this.data.activeSupplies.push(bill);
                renderDashboard();
                console.log('Bill added to active supplies (mock mode):', bill);
                return bill;
            }

            // For non-mock mode, this would use Firebase/Supabase
            // For now, just add to local data
            if (!bill.id) {
                bill.id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
            }
            this.data.activeSupplies.push(bill);
            renderDashboard();
            console.log('Bill added to active supplies:', bill);
            return bill;
        } catch (e) {
            showToast("Error adding bill to active supplies");
            console.error("Error adding bill to active supplies:", e);
            throw e;
        }
    }

    async removeTemporaryBill(billId) {
        try {
            if (mockMode) {
                this.data.temporaryBills = this.data.temporaryBills.filter(bill => bill.id !== billId);
                renderDashboard();
                showToast('Bill removed from staging!');
                return;
            }

            const docRef = doc(db, `artifacts/${appId}/users/${userId}/temporaryBills`, billId);
            await deleteDoc(docRef);
            showToast('Bill removed from staging!');
        } catch (e) {
            showToast("Error removing bill");
            console.error("Error removing document:", e);
        }
    }

    async moveSelectedBillsToDispatch(billIds) {
        try {
            if (mockMode) {
                const billsToMove = this.data.temporaryBills.filter(bill => billIds.includes(bill.id));
                billsToMove.forEach(bill => {
                    this.data.bills.push({ ...bill });
                });
                this.data.temporaryBills = this.data.temporaryBills.filter(bill => !billIds.includes(bill.id));
                renderDashboard();
                showToast(`${billIds.length} bill(s) submitted to dispatch!`);
                return;
            }

            for (const billId of billIds) {
                const billDocRef = doc(this.collections.temporaryBills, billId);
                const billDoc = await getDoc(billDocRef);
                if (billDoc.exists()) {
                    await addDoc(this.collections.bills, billDoc.data());
                    await deleteDoc(billDocRef);
                }
            }
            showToast(`${billIds.length} bill(s) submitted to dispatch!`);
        } catch (e) {
            showToast("Error submitting bills");
            console.error("Error submitting bills:", e);
        }
    }

    async moveBillToActiveSupplies(billIds, supplyThrough) {
        try {
            if (mockMode) {
                const billsToMove = this.data.bills.filter(bill => billIds.includes(bill.billNumber));
                billsToMove.forEach(bill => {
                    this.data.activeSupplies.push({
                        ...bill,
                        supplyThrough: supplyThrough,
                        status: 'In Progress'
                    });
                });
                this.data.bills = this.data.bills.filter(bill => !billIds.includes(bill.billNumber));
                renderDashboard();
                showToast(`${billIds.length} bill(s) moved to supplies`);
                return;
            }

            const q = query(this.collections.bills, where("billNumber", "in", billIds));
            const querySnapshot = await getDocs(q);
            for (const doc of querySnapshot.docs) {
                await addDoc(this.collections.activeSupplies, { ...doc.data(), supplyThrough: supplyThrough, status: 'In Progress' });
                await deleteDoc(doc.ref);
            }
            showToast(`${billIds.length} bill(s) moved to supplies`);
        } catch (e) {
            showToast("Error moving bills");
            console.error("Error moving bills:", e);
        }
    }

    async moveBackToBills(billId) {
        try {
            // Mock mode implementation only - Firebase code removed
            if (mockMode) {
                const bill = this.data.bills.find(b => b.id === billId);
                if (bill) {
                    this.data.temporaryBills.push({ ...bill });
                    this.data.bills = this.data.bills.filter(b => b.id !== billId);
                    renderDashboard();
                    showToast(`Bill moved back to staging`);
                } else {
                    showToast("Bill not found");
                }
                return;
            }

            // Non-mock implementation should be handled by subclasses (SupabaseAppState)
            console.warn('moveBackToBills called on base AppState without mock mode');
            showToast('Feature not available in this mode');
        } catch (e) {
            showToast("Error moving bill back");
            console.error("Error moving bill back:", e);
        }
    }

    async setRetailers(newRetailers) {
        try {
            if (mockMode) {
                const uniqueRetailers = new Map();
                newRetailers.forEach((r, index) => {
                    const key = `${String(r.name).toLowerCase()}-${String(r.sector).toLowerCase()}`;
                    if (!uniqueRetailers.has(key)) {
                        uniqueRetailers.set(key, { ...r, id: (Date.now() + index).toString() });
                    }
                });
                this.data.retailers = Array.from(uniqueRetailers.values());
                renderDashboard();
                showToast(`Uploaded ${uniqueRetailers.size} retailers`);
                return;
            }

            const q = query(this.collections.retailers);
            const querySnapshot = await getDocs(q);
            for (const doc of querySnapshot.docs) {
                await deleteDoc(doc.ref);
            }

            const uniqueRetailers = new Map();
            newRetailers.forEach(r => {
                const key = `${String(r.name).toLowerCase()}-${String(r.sector).toLowerCase()}`;
                if (!uniqueRetailers.has(key)) {
                    uniqueRetailers.set(key, r);
                }
            });

            for (const retailer of uniqueRetailers.values()) {
                await addDoc(this.collections.retailers, retailer);
            }
            showToast(`Uploaded ${uniqueRetailers.size} retailers`);
        } catch (e) {
            showToast("Error setting retailers");
            console.error("Error setting retailers:", e);
        }
    }

    async addRetailers(newRetailers) {
        try {
            if (mockMode) {
                const existingRetailers = this.data.retailers || [];
                const existingNames = new Set(existingRetailers.map(r => r.name.toLowerCase().trim()));

                const uniqueRetailersToAdd = newRetailers.filter(r =>
                    !existingNames.has(r.name.toLowerCase().trim())
                );

                if (uniqueRetailersToAdd.length > 0) {
                    const retailersWithIds = uniqueRetailersToAdd.map((r, index) => ({
                        ...r,
                        id: (Date.now() + index).toString()
                    }));

                    this.data.retailers = [...existingRetailers, ...retailersWithIds];
                    renderDashboard();
                }

                showToast(`Added ${uniqueRetailersToAdd.length} new retailers`);
                return uniqueRetailersToAdd.length;
            }

            // Firebase implementation - add without deleting existing
            const uniqueRetailers = new Map();
            newRetailers.forEach(r => {
                const key = `${String(r.name).toLowerCase()}-${String(r.sector).toLowerCase()}`;
                if (!uniqueRetailers.has(key)) {
                    uniqueRetailers.set(key, r);
                }
            });

            let addedCount = 0;
            for (const retailer of uniqueRetailers.values()) {
                await addDoc(this.collections.retailers, retailer);
                addedCount++;
            }

            showToast(`Added ${addedCount} new retailers`);
            return addedCount;
        } catch (e) {
            showToast("Error adding retailers");
            console.error("Error adding retailers:", e);
            return 0;
        }
    }
    // Add these methods to the AppState class after setRetailers method

    // Method to set persons
    setPersons(persons) {
        if (mockMode) {
            this.data.persons = persons;
            renderDashboard();
            return;
        }

        // Firebase implementation would go here
    }

    // Method to add a person
    addPerson(name) {
        if (!this.data.persons) {
            this.data.persons = [];
        }

        const exists = this.data.persons.some(p =>
            String(p).toLowerCase() === String(name).toLowerCase()
        );

        if (!exists) {
            this.data.persons.push(name);
            renderDashboard();
            showToast(`Added '${name}' to persons list`);
            return true;
        } else {
            showToast(`'${name}' already exists in persons list`);
            return false;
        }
    }

    // Method to remove a person
    removePerson(name) {
        if (!this.data.persons) return;

        this.data.persons = this.data.persons.filter(p => p !== name);
        renderDashboard();
        showToast(`Removed '${name}' from persons list`);
    }

    // Method to assign Ugrai to person
    async assignUgraiToPersons(assignments) {
        if (!this.data.ugraiAssignments) {
            this.data.ugraiAssignments = {};
        }

        // Merge new assignments with existing ones
        this.data.ugraiAssignments = { ...this.data.ugraiAssignments, ...assignments };

        console.log('📋 Assignment updated, moving bills to in-progress...');

        // Move assigned bills to ugraiInProgress
        await this.moveAssignedBillsToInProgress();

        renderDashboard();

        // Immediately refresh the assigned bills table to show updates
        renderAssignedUgraiBillsTableSync();

        const sectorCount = Object.keys(assignments).length;
        showToast(`Updated assignments for ${sectorCount} sector(s)`);
    }

    // Helper method to move assigned bills to in-progress
    async moveAssignedBillsToInProgress() {
        if (!this.data.ugraiInProgress) this.data.ugraiInProgress = [];

        const assignments = this.data.ugraiAssignments || {};
        const assignedSectors = Object.keys(assignments).filter(sector =>
            assignments[sector] && assignments[sector].trim() !== ''
        );

        console.log('🔄 Moving bills for assigned sectors:', assignedSectors);

        let movedCount = 0;

        // Check ugraiData for bills in assigned sectors
        if (this.data.ugraiData && this.data.ugraiData.length > 0) {
            for (let i = this.data.ugraiData.length - 1; i >= 0; i--) {
                const bill = this.data.ugraiData[i];
                const billSector = bill.sector || bill.Sector;

                if (assignedSectors.includes(billSector)) {
                    // Check if already in progress
                    const exists = this.data.ugraiInProgress.find(existing =>
                        existing.billNumber === bill.billNumber
                    );

                    if (!exists) {
                        // Add assigned person info to the bill
                        const enhancedBill = {
                            ...bill,
                            assignedTo: assignments[billSector],
                            assignedDate: new Date().toISOString().split('T')[0],
                            status: 'In Progress'
                        };

                        this.data.ugraiInProgress.push(enhancedBill);
                        movedCount++;
                        console.log(`✅ Moved ${bill.billNumber} to in-progress (assigned to: ${assignments[billSector]})`);
                    }
                }
            }
        }

        // Check ugraiEntries for bills in assigned sectors
        if (this.data.ugraiEntries && this.data.ugraiEntries.length > 0) {
            for (let i = this.data.ugraiEntries.length - 1; i >= 0; i--) {
                const bill = this.data.ugraiEntries[i];
                const billSector = bill.sector || bill.Sector;

                if (assignedSectors.includes(billSector)) {
                    // Check if already in progress
                    const exists = this.data.ugraiInProgress.find(existing =>
                        existing.billNumber === bill.billNumber
                    );

                    if (!exists) {
                        // Add assigned person info to the bill
                        const enhancedBill = {
                            ...bill,
                            assignedTo: assignments[billSector],
                            assignedDate: new Date().toISOString().split('T')[0],
                            status: 'In Progress'
                        };

                        this.data.ugraiInProgress.push(enhancedBill);
                        movedCount++;
                        console.log(`✅ Moved ${bill.billNumber} to in-progress (assigned to: ${assignments[billSector]})`);
                    }
                }
            }
        }

        console.log(`📊 Moved ${movedCount} bills to in-progress state`);

        // Note: Persistence to database will be handled by the existing sync mechanisms
        // The in-memory data is immediately available for display
    }

    // Method to clear all assignments
    async clearAllAssignments() {
        try {
            // Clear from database if using Supabase
            if (this.supabaseService && !mockMode) {
                await this.supabaseService.clearUgraiAssignments();
                await this.supabaseService.clearUgraiInProgress();
                console.log('✅ Cleared assignments and in-progress bills from database');
            }

            // Clear from local state
            this.data.ugraiAssignments = {};
            this.data.ugraiInProgress = [];

            renderDashboard();
            showToast('Cleared all Ugrai assignments and in-progress bills');
        } catch (error) {
            console.error('❌ Error clearing assignments:', error);
            showToast('Error clearing assignments. Please try again.', 'error');
        }
    }

    async addRetailer(name, sector) {
        const newRetailer = { name: String(name), sector: String(sector) };

        if (mockMode) {
            const exists = this.data.retailers.some(r =>
                String(r.name).toLowerCase() === String(name).toLowerCase() &&
                String(r.sector).toLowerCase() === String(sector).toLowerCase()
            );
            if (!exists) {
                newRetailer.id = Date.now().toString();
                this.data.retailers.push(newRetailer);
                renderDashboard();
                showToast(`'${name}' added successfully!`);
            } else {
                showToast("Retailer already exists");
            }
            return;
        }

        const q = query(this.collections.retailers, where("name", "==", name), where("sector", "==", sector));
        const querySnapshot = await getDocs(q);
        if (querySnapshot.empty) {
            try {
                await addDoc(this.collections.retailers, newRetailer);
                showToast(`'${name}' added successfully!`);
            } catch (e) {
                showToast("Error adding retailer");
                console.error("Error adding retailer: ", e);
            }
        } else {
            showToast("Retailer already exists");
        }
    }

    async approveSelectedBills(billNumbers) {
        try {
            if (mockMode) {
                const billsToApprove = this.data.activeSupplies.filter(b => billNumbers.includes(b.billNumber));

                billsToApprove.forEach(bill => {
                    // For edited bills, also add to editedBills collection
                    if (bill.status === 'Edited') {
                        this.data.editedBills.push({ ...bill });
                    }

                    // Send to Google Sheets (mock)
                    console.log('Sending to Google Sheets:', bill);
                });

                // Remove approved bills from activeSupplies
                this.data.activeSupplies = this.data.activeSupplies.filter(b => !billNumbers.includes(b.billNumber));

                renderDashboard();
                showToast(`${billNumbers.length} bills approved and sent to Google Sheets!`);
                return;
            }

            const q = query(this.collections.activeSupplies, where("billNumber", "in", billNumbers));
            const querySnapshot = await getDocs(q);

            for (const billDoc of querySnapshot.docs) {
                const billData = billDoc.data();

                // For edited bills, also add to editedBills collection
                if (billData.status === 'Edited') {
                    await addDoc(this.collections.editedBills, billData);
                }

                // Send to Google Sheets (you'll need to implement this)
                await this.sendToGoogleSheets(billData);

                // Remove from activeSupplies
                await deleteDoc(billDoc.ref);
            }

            showToast(`${billNumbers.length} bills approved and sent to Google Sheets!`);
        } catch (e) {
            showToast("Error approving bills");
            console.error("Error approving bills:", e);
        }
    }

    async approveBill(billNumber) {
        try {
            if (mockMode) {
                const billIndex = this.data.activeSupplies.findIndex(bill => bill.billNumber === billNumber);
                if (billIndex !== -1) {
                    const bill = { ...this.data.activeSupplies[billIndex] };

                    // For edited bills, also add to editedBills collection
                    if (bill.status === 'Edited') {
                        this.data.editedBills.push({ ...bill });
                    }

                    // Send to Google Sheets (mock)
                    console.log('Sending to Google Sheets:', bill);

                    // Remove from activeSupplies
                    this.data.activeSupplies.splice(billIndex, 1);
                    renderDashboard();
                    showToast(`Bill ${billNumber} approved and sent to Google Sheets`);
                } else {
                    showToast('Bill not found');
                }
                return;
            }

            const q = query(this.collections.activeSupplies, where("billNumber", "==", billNumber));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const docRef = querySnapshot.docs[0].ref;
                const data = querySnapshot.docs[0].data();

                // For edited bills, also add to editedBills collection
                if (data.status === 'Edited') {
                    await addDoc(this.collections.editedBills, data);
                }

                // Send to Google Sheets (you'll need to implement this)
                await this.sendToGoogleSheets(data);

                // Remove from activeSupplies
                await deleteDoc(docRef);
                showToast(`Bill ${billNumber} approved and sent to Google Sheets`);
            } else {
                showToast('Bill not found');
            }
        } catch (e) {
            showToast("Error approving bill");
            console.error("Error approving document:", e);
        }
    }

    async removeEditedBill(billId) {
        try {
            console.log('🗑️ AppState: Removing edited bill with ID:', billId, 'Type:', typeof billId);
            console.log('📋 Current edited bills before removal:', this.data.editedBills.map(b => ({ id: b.id, type: typeof b.id, billNumber: b.billNumber })));

            if (mockMode) {
                this.data.editedBills = this.data.editedBills.filter(bill => bill.id !== billId);
                renderDashboard();
                return;
            }

            // Supabase implementation
            if (this.supabaseService && typeof this.supabaseService.removeEditedBill === 'function') {
                await this.supabaseService.removeEditedBill(billId);
            }

            // Remove from local array for UI (try both strict and loose comparison)
            const initialCount = this.data.editedBills.length;
            this.data.editedBills = this.data.editedBills.filter(bill => {
                const matches = bill.id !== billId && bill.id != billId && String(bill.id) !== String(billId);
                if (!matches) {
                    console.log('🎯 Removing bill from local array:', { billId: bill.id, targetId: billId, billNumber: bill.billNumber });
                }
                return matches;
            });

            const finalCount = this.data.editedBills.length;
            console.log('📊 Edited bills count: before=' + initialCount + ', after=' + finalCount);
            console.log('📋 Remaining edited bills after removal:', this.data.editedBills.map(b => ({ id: b.id, billNumber: b.billNumber })));

            renderDashboard();
        } catch (e) {
            showToast("Error removing edited bill");
            console.error("Error removing edited bill:", e);
        }
    }

    // Placeholder for Google Sheets integration
    async sendToGoogleSheets(billData) {
        // You'll need to implement Google Sheets API integration here
        console.log('Would send to Google Sheets:', billData);
    }

    setReportFilter(key, value) {
        this.reportFilter[key] = value;
        renderDashboard();
    }
    // Purchase methods
    async addPurchaseRetailer(retailer) {
        try {
            console.log('💾 addPurchaseRetailer called with retailer:', retailer);
            console.log('🔧 Mock mode:', mockMode);
            console.log('🔧 Supabase service available:', !!this.supabaseService);

            // Use local mode only if explicitly in mock mode
            if (mockMode) {
                console.log('📝 Using local/mock mode for purchase retailer');
                retailer.id = Date.now().toString();
                this.data.purchaseRetailers.push(retailer);
                renderDashboard();
                console.log('✅ Purchase retailer added successfully in local mode');
                return;
            }

            // Use Supabase service
            console.log('🔥 Using Supabase mode for purchase retailer');
            const result = await this.supabaseService.addPurchaseRetailer(retailer.retailerName, retailer.dueDays);

            // Update local data (real-time subscription will also update it)
            this.data.purchaseRetailers.push(result);
            renderDashboard();
            console.log('✅ Purchase retailer added successfully in Supabase mode');
        } catch (e) {
            showToast("Error adding purchase retailer");
            console.error("Error adding purchase retailer:", e);
        }
    }

    async setPurchaseRetailers(retailers) {
        try {
            console.log('💾 setPurchaseRetailers called with:', retailers.length, 'retailers');
            console.log('🔧 Mock mode:', mockMode);
            console.log('🔧 Supabase service available:', !!this.supabaseService);

            // Use local mode only if explicitly in mock mode
            if (mockMode) {
                console.log('📝 Using local/mock mode for purchase retailers');
                this.data.purchaseRetailers = retailers.map((r, index) => ({
                    ...r,
                    id: (Date.now() + index).toString()
                }));

                console.log('📊 Purchase retailers data set:', this.data.purchaseRetailers);

                // Show the table container
                const tableContainer = document.getElementById('purchase-data-table-container');
                if (tableContainer) {
                    tableContainer.classList.remove('hidden');
                    console.log('👀 Purchase table container made visible');
                } else {
                    console.log('❌ Purchase table container not found');
                }

                // Re-render the dashboard to populate the table
                console.log('🔄 Calling renderDashboard to update display');
                renderDashboard();

                // Force render purchase table data directly (in case tab visibility affects rendering)
                const directPurchaseTable = document.getElementById('purchase-retailer-table');
                if (directPurchaseTable && this.data.purchaseRetailers) {
                    console.log('🔄 Direct rendering purchase table to ensure visibility');
                    const tableHTML = this.data.purchaseRetailers.map(r => `
                        <tr class="table-row">
                            <td data-label="Retailer Name">${r.retailerName}</td>
                            <td data-label="Due Days">${r.dueDays}</td>
                        </tr>
                    `).join('');
                    directPurchaseTable.innerHTML = tableHTML;
                    console.log('🔍 Direct render complete:', tableHTML.length, 'characters');
                }

                // Debug: Verify table was populated after rendering
                const tableAfterRender = document.getElementById('purchase-retailer-table');
                console.log('🔍 After renderDashboard - Table innerHTML:', tableAfterRender?.innerHTML);
                console.log('🔍 After renderDashboard - Data in appState:', this.data.purchaseRetailers?.length);

                console.log('✅ Purchase retailers set successfully in local mode');
                return;
            }

            // Use Supabase service for bulk upload
            console.log('🔥 Using Supabase mode for purchase retailers');
            const results = await this.supabaseService.bulkAddPurchaseRetailers(retailers);

            // Update local data with results
            this.data.purchaseRetailers = results;

            // Show the table container
            const tableContainer = document.getElementById('purchase-data-table-container');
            if (tableContainer) {
                tableContainer.classList.remove('hidden');
                console.log('👀 Purchase table container made visible');
            }

            // Re-render the dashboard
            renderDashboard();

            // Force render purchase table data directly (in case tab visibility affects rendering)
            const directPurchaseTable = document.getElementById('purchase-retailer-table');
            if (directPurchaseTable && this.data.purchaseRetailers) {
                console.log('🔄 Supabase - Direct rendering purchase table to ensure visibility');
                const tableHTML = this.data.purchaseRetailers.map(r => `
                    <tr class="table-row">
                        <td data-label="Retailer Name">${r.retailerName}</td>
                        <td data-label="Due Days">${r.dueDays}</td>
                    </tr>
                `).join('');
                directPurchaseTable.innerHTML = tableHTML;
                console.log('🔍 Supabase - Direct render complete:', tableHTML.length, 'characters');
            }

            // Debug: Verify table was populated after rendering  
            const tableAfterRender = document.getElementById('purchase-retailer-table');
            console.log('🔍 Supabase - After renderDashboard - Table innerHTML:', tableAfterRender?.innerHTML);
            console.log('🔍 Supabase - After renderDashboard - Data in appState:', this.data.purchaseRetailers?.length);
            console.log('🔍 Supabase - Results from database:', results?.length);

            console.log('✅ Purchase retailers set successfully in Supabase mode');
        } catch (e) {
            showToast("Error setting purchase retailers");
            console.error("Error setting purchase retailers:", e);
        }
    }
    async addPurchaseEntry(entry) {
        try {
            console.log('💾 addPurchaseEntry called with entry:', entry);
            console.log('🔧 Mock mode:', mockMode);
            console.log('🔧 Supabase service available:', !!this.supabaseService);

            // Use local mode only if explicitly in mock mode
            if (mockMode) {
                console.log('📝 Using local/mock mode for purchase entry');
                if (!entry.id) {
                    entry.id = entry.uniqueId || Date.now().toString();  // Ensure ID is set
                }
                entry.createdAt = new Date().toISOString();

                // For debugging
                console.log("Added entry with ID:", entry.id);

                this.data.purchaseEntries.unshift(entry); // Add to beginning for latest on top
                console.log("Current purchaseEntries:", this.data.purchaseEntries);

                // Force render dashboard after adding an entry
                if (typeof window.enhancePurchaseTables === 'function') {
                    window.enhancePurchaseTables();
                } else if (typeof enhancePurchaseTables === 'function') {
                    enhancePurchaseTables();
                }
                renderDashboard();
                showToast('Purchase entry added successfully!');
                console.log('✅ Purchase entry added successfully in local mode');
                return;
            }

            // Use Supabase service
            console.log('🔥 Using Supabase mode for purchase entry');
            const result = await this.supabaseService.addPurchaseEntry(entry);

            // Update local data (real-time subscription will also update it)
            this.data.purchaseEntries.unshift(result);

            // Force render dashboard after adding an entry
            if (typeof window.enhancePurchaseTables === 'function') {
                window.enhancePurchaseTables();
            } else if (typeof enhancePurchaseTables === 'function') {
                enhancePurchaseTables();
            }
            renderDashboard();
            showToast('Purchase entry added successfully!');
            console.log('✅ Purchase entry added successfully in Supabase mode');
        } catch (e) {
            showToast("Error adding purchase entry");
            console.error("Error adding purchase entry:", e);
        }
    }

    async updatePurchaseEntry(entryId, updates) {
        try {
            console.log('🔄 updatePurchaseEntry called with:', entryId, updates);

            if (mockMode) {
                // Find and update entry in local data
                const entryIndex = this.data.purchaseEntries.findIndex(e => e.id === entryId || e.uniqueId === entryId);
                if (entryIndex !== -1) {
                    this.data.purchaseEntries[entryIndex] = { ...this.data.purchaseEntries[entryIndex], ...updates };
                    renderDashboard();
                    console.log('✅ Purchase entry updated successfully in local mode');
                }
                return;
            }

            // Use Supabase service
            console.log('🔥 Using Supabase mode for purchase entry update');
            await this.supabaseService.updatePurchaseEntry(entryId, updates);

            // Update local data
            const entryIndex = this.data.purchaseEntries.findIndex(e => e.id === entryId);
            if (entryIndex !== -1) {
                this.data.purchaseEntries[entryIndex] = { ...this.data.purchaseEntries[entryIndex], ...updates };
            }

            renderDashboard();
            console.log('✅ Purchase entry updated successfully in Supabase mode');
        } catch (e) {
            showToast("Error updating purchase entry");
            console.error("Error updating purchase entry:", e);
        }
    }

    async confirmPurchaseEntry(entryId, voucherNumber = null) {
        try {
            console.log('✅ confirmPurchaseEntry called with:', entryId, voucherNumber);
            console.log('🔧 Current mockMode:', mockMode);
            console.log('🔧 Supabase service available:', !!this.supabaseService);

            if (mockMode) {
                // Find and update entry status in local data
                const entryIndex = this.data.purchaseEntries.findIndex(e => e.id === entryId || e.uniqueId === entryId);
                if (entryIndex !== -1) {
                    this.data.purchaseEntries[entryIndex].status = 'Confirmed';
                    if (voucherNumber) {
                        this.data.purchaseEntries[entryIndex].voucherNumber = voucherNumber;
                    }
                    this.data.purchaseEntries[entryIndex].confirmedAt = new Date().toISOString();

                    if (typeof enhancePurchaseTables === 'function') {
                        enhancePurchaseTables();
                    }
                    renderDashboard();
                    console.log('✅ Purchase entry confirmed successfully in local mode');
                }
                return;
            }

            // Use Supabase service
            console.log('🔥 Using Supabase mode for purchase entry confirmation');
            console.log('📤 Saving to Supabase: entryId =', entryId, 'voucherNumber =', voucherNumber);

            await this.supabaseService.confirmPurchaseEntry(entryId, voucherNumber);
            console.log('✅ Successfully saved confirmation to Supabase');

            // Update local data
            const entryIndex = this.data.purchaseEntries.findIndex(e => e.id === entryId);
            console.log('🔍 Finding entry in local data, index:', entryIndex);

            if (entryIndex !== -1) {
                console.log('📝 Updating local entry status to Confirmed');
                this.data.purchaseEntries[entryIndex].status = 'Confirmed';
                if (voucherNumber) {
                    this.data.purchaseEntries[entryIndex].voucherNumber = voucherNumber;
                }
                this.data.purchaseEntries[entryIndex].confirmedAt = new Date().toISOString();
                console.log('📝 Local entry updated:', this.data.purchaseEntries[entryIndex]);
            } else {
                console.error('❌ Could not find entry in local data for update');
            }

            if (typeof enhancePurchaseTables === 'function') {
                enhancePurchaseTables();
            }
            renderDashboard();
            console.log('✅ Purchase entry confirmed successfully in Supabase mode');
        } catch (e) {
            showToast("Error confirming purchase entry");
            console.error("Error confirming purchase entry:", e);
        }
    }

    async completePurchaseEntry(entryId, voucherNumber) {
        try {
            console.log('🏁 completePurchaseEntry called with:', entryId, voucherNumber);

            const entry = this.data.purchaseEntries.find(e => e.id === entryId || e.uniqueId === entryId);
            if (!entry) {
                console.error('Entry not found for completion');
                return;
            }

            if (mockMode) {
                // Find and update entry status in local data
                const entryIndex = this.data.purchaseEntries.findIndex(e => e.id === entryId || e.uniqueId === entryId);
                if (entryIndex !== -1) {
                    this.data.purchaseEntries[entryIndex].status = 'Completed';
                    this.data.purchaseEntries[entryIndex].voucherNumber = voucherNumber;
                    this.data.purchaseEntries[entryIndex].completedAt = new Date().toISOString();

                    // Calculate due date
                    const billDate = new Date(entry.billDate);
                    const retailer = this.data.purchaseRetailers.find(r => r.retailerName === entry.retailerName);
                    const dueDays = retailer ? retailer.dueDays : 30;
                    const dueDate = new Date(billDate);
                    dueDate.setDate(billDate.getDate() + dueDays);
                    this.data.purchaseEntries[entryIndex].dueDate = dueDate.toISOString().split('T')[0];

                    if (typeof enhancePurchaseTables === 'function') {
                        enhancePurchaseTables();
                    }
                    renderDashboard();
                    console.log('✅ Purchase entry completed successfully in local mode');
                }
                return;
            }

            // Use Supabase service
            console.log('🔥 Using Supabase mode for purchase entry completion');

            // Calculate due date
            const billDate = new Date(entry.billDate);
            const retailer = this.data.purchaseRetailers.find(r => r.retailerName === entry.retailerName);
            const dueDays = retailer ? retailer.dueDays : 30;
            const dueDate = new Date(billDate);
            dueDate.setDate(billDate.getDate() + dueDays);

            const updates = {
                status: 'Completed',
                voucherNumber: voucherNumber,
                completedAt: new Date().toISOString(),
                dueDate: dueDate.toISOString().split('T')[0]
            };

            await this.supabaseService.updatePurchaseEntry(entryId, updates);

            // Update local data
            const entryIndex = this.data.purchaseEntries.findIndex(e => e.id === entryId);
            if (entryIndex !== -1) {
                Object.assign(this.data.purchaseEntries[entryIndex], updates);
            }

            if (typeof enhancePurchaseTables === 'function') {
                enhancePurchaseTables();
            }
            renderDashboard();
            console.log('✅ Purchase entry completed successfully in Supabase mode');
        } catch (e) {
            showToast("Error completing purchase entry");
            console.error("Error completing purchase entry:", e);
        }
    }

    generatePurchaseUniqueId() {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000);
        return `PUR-${timestamp}-${random}`;
    }
}

// Enhanced AppState class with Supabase integration
class SupabaseAppState extends AppState {
    constructor() {
        super();
        this.supabaseService = new SupabaseDataService();
        // Make supabaseService globally available for debugging
        window.supabaseService = this.supabaseService;
        this.subscriptions = [];
        this.connectionStatus = 'disconnected';
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 3;
    }

    async init() {
        if (mockMode) {
            this.initMockData();
        } else {
            // Initialize Supabase and setup real-time subscriptions
            await this.initSupabaseConnection();

            // Initialize authentication
            console.log('🔐 Initializing authentication...');
            await this.supabaseService.initializeAuth();

            await this.loadSupabaseData();
            this.setupSupabaseListeners();
            console.log('✅ Real-time subscriptions activated');
        }
    }

    async initSupabaseConnection() {
        const success = await initSupabase();
        if (!success) {
            console.warn('Failed to initialize Supabase, falling back to mock mode');
            mockMode = true;
            this.initMockData();
        }
    }

    async loadSupabaseData() {
        try {
            console.log('📊 Loading all data from Supabase...');

            // Google Sheets edition: all datasets are requested at the same time.
            // sheets-client.js bundles them into ONE request to Google Apps Script
            // (much faster than 14 sequential round trips).
            const svc = this.supabaseService;
            const [
                userRole, retailers, temporaryBills, bills, activeSupplies, approvedBills, editedBills,
                ugraiData, ugraiEntries, ugraiAssignments, completedUgrai, ugraiInProgress,
                purchaseRetailers, purchaseEntries
            ] = await Promise.all([
                svc.getUserRole(),                 // CRITICAL for delivery persons
                svc.getRetailers(),
                svc.getStagedBills(),
                svc.getDispatchBills(),
                svc.getActiveSupplies(),
                svc.getApprovedBills(),
                svc.getEditedBills(),
                svc.getUgraiData(),
                svc.getUgraiEntries(),
                svc.getUgraiAssignments(),
                svc.getCompletedUgrai(),
                svc.getUgraiInProgress(),
                svc.getPurchaseRetailers(),
                svc.getPurchaseEntries()
            ]);

            this.userRole = userRole;
            console.log('👤 User role loaded:', this.userRole);

            // Supply-related data
            this.data.retailers = retailers;
            this.data.temporaryBills = temporaryBills;
            this.data.bills = bills;
            this.data.activeSupplies = activeSupplies;
            this.data.approvedBills = approvedBills;
            this.data.editedBills = editedBills;

            // UGRAI data
            this.data.ugraiData = ugraiData || [];
            this.data.ugraiEntries = ugraiEntries || [];
            this.data.ugraiAssignments = ugraiAssignments || {};
            this.data.completedUgrai = completedUgrai || [];

            // UGRAI In Progress (bills assigned to delivery persons)
            this.data.ugraiInProgress = ugraiInProgress || [];
            console.log('🚚 UGRAI In Progress loaded:', this.data.ugraiInProgress.length, 'bills');

            // Purchase data
            this.data.purchaseRetailers = purchaseRetailers || [];
            this.data.purchaseEntries = purchaseEntries || [];

            console.log('🛒 Purchase data loaded:', {
                retailers: this.data.purchaseRetailers.length,
                entries: this.data.purchaseEntries.length
            });
            console.log('🛒 Purchase retailers:', this.data.purchaseRetailers);
            console.log('🛒 Purchase entries:', this.data.purchaseEntries);

            console.log('✅ All Supabase data loaded successfully:', {
                userRole: this.userRole,
                retailers: this.data.retailers.length,
                temporaryBills: this.data.temporaryBills.length,
                bills: this.data.bills.length,
                activeSupplies: this.data.activeSupplies.length,
                approvedBills: this.data.approvedBills.length,
                ugraiData: this.data.ugraiData.length,
                ugraiEntries: this.data.ugraiEntries.length,
                ugraiInProgress: this.data.ugraiInProgress.length,
                completedUgrai: this.data.completedUgrai.length,
                purchaseEntries: this.data.purchaseEntries.length
            });

        } catch (error) {
            console.error('❌ Error loading Supabase data:', error);
            showToast('Error loading data from database', 'error');
        }
    }

    setupSupabaseListeners() {
        // Set up real-time subscriptions with connection monitoring
        try {
            const subscriptionConfig = {
                onSubscribed: () => {
                    this.connectionStatus = 'connected';
                    this.reconnectAttempts = 0;
                    console.log('🟢 Real-time connection established');
                },
                onError: (error) => {
                    this.connectionStatus = 'error';
                    console.warn('🔴 Real-time connection error:', error);
                    this.handleConnectionError();
                },
                onDisconnected: () => {
                    this.connectionStatus = 'disconnected';
                    console.warn('🟡 Real-time connection lost, attempting to reconnect...');
                    this.handleReconnection();
                }
            };

            this.subscriptions.push(
                this.supabaseService.subscribeToRetailers((payload) => {
                    console.log('📡 Retailers updated:', payload.eventType);
                    this.loadRetailers();
                }),
                this.supabaseService.subscribeToBills((payload) => {
                    console.log('📡 Bills updated:', payload.eventType);
                    this.loadBills();
                }),
                this.supabaseService.subscribeToActiveSupplies((payload) => {
                    console.log('📡 Active supplies updated:', payload.eventType);
                    this.loadActiveSupplies();
                }),
                this.supabaseService.subscribeToApprovedBills((payload) => {
                    console.log('📡 Approved bills updated:', payload.eventType);
                    this.loadApprovedBills();
                }),
                // UGRAI real-time subscriptions - efficient updates without full reload
                this.supabaseService.subscribeToUgraiData((payload) => {
                    console.log('📡 UGRAI Data updated:', payload.eventType, payload.new?.bill_number || payload.old?.bill_number);
                    this.loadUgraiDataOnly();
                }),
                this.supabaseService.subscribeToUgraiEntries((payload) => {
                    console.log('📡 UGRAI Entries updated:', payload.eventType, payload.new?.bill_number || payload.old?.bill_number);
                    this.loadUgraiEntriesOnly();
                }),
                this.supabaseService.subscribeToCompletedUgrai((payload) => {
                    console.log('📡 Completed UGRAI updated:', payload.eventType, payload.new?.bill_number || payload.old?.bill_number);
                    this.loadCompletedUgraiOnly();
                }),
                // Purchase real-time subscriptions
                this.supabaseService.subscribeToPurchaseRetailers((payload) => {
                    console.log('📡 Purchase retailers updated:', payload.eventType, payload.new?.retailer_name || payload.old?.retailer_name);
                    this.loadPurchaseRetailersOnly();
                }),
                this.supabaseService.subscribeToPurchaseEntries((payload) => {
                    console.log('📡 Purchase entries updated:', payload.eventType, payload.new?.bill_number || payload.old?.bill_number);
                    this.loadPurchaseEntriesOnly();
                })
            );

            this.connectionStatus = 'connected';
        } catch (error) {
            console.warn('⚠️ Real-time subscriptions failed, app will still work:', error);
            this.connectionStatus = 'error';
        }
    }

    handleConnectionError() {
        // App continues to work, but real-time updates may be delayed
        // Users will still see updates on manual actions due to explicit data loading
        this.updateConnectionDisplay();
    }

    handleReconnection() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
                console.log(`🔄 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
                this.setupSupabaseListeners();
            }, 2000 * this.reconnectAttempts); // Exponential backoff
        } else {
            console.warn('🔴 Max reconnection attempts reached. Real-time updates disabled.');
            // App still works, just without real-time updates
            this.updateConnectionDisplay();
        }
    }

    updateConnectionDisplay() {
        if (userIdDisplay) {
            const statusIcon = this.connectionStatus === 'connected' ? '🟢' :
                this.connectionStatus === 'error' ? '🔴' : '🟡';
            const statusText = this.connectionStatus === 'connected' ? 'Connected' :
                this.connectionStatus === 'error' ? 'Offline' : 'Reconnecting';
            userIdDisplay.textContent = `${statusIcon} User ID: ${userId} (${statusText})`;
            if (navUserIdDisplay) {
                navUserIdDisplay.textContent = userId;
            }
        }
    }

    async loadRetailers() {
        // Skip reload if user is actively editing (prevent UI revert)
        if (window.isEditingRetailerSector) {
            console.log('⏸️ Skipping retailer reload - user is editing');
            return;
        }

        this.data.retailers = await this.supabaseService.getRetailers();
        renderDashboard();
    }

    async loadBills() {
        this.data.temporaryBills = await this.supabaseService.getStagedBills();
        this.data.bills = await this.supabaseService.getDispatchBills();
        renderDashboard();
    }

    async loadActiveSupplies() {
        console.log('🔄 Loading active supplies...');
        this.data.activeSupplies = await this.supabaseService.getActiveSupplies();
        console.log('📦 Active supplies loaded into appState.data.activeSupplies:', this.data.activeSupplies);
        console.log('🎨 Calling renderDashboard to update UI...');
        renderDashboard();
    }

    async loadApprovedBills() {
        this.data.approvedBills = await this.supabaseService.getApprovedBills();
        renderDashboard();
    }

    async loadEditedBills() {
        console.log('🔄 Loading edited bills...');
        this.data.editedBills = await this.supabaseService.getEditedBills();
        console.log('📝 Edited bills loaded into appState.data.editedBills:', this.data.editedBills);
        renderDashboard();
    }

    // Efficient UGRAI data loading methods (without cleanup) for real-time subscriptions
    async loadUgraiDataOnly() {
        try {
            this.data.ugraiData = await this.supabaseService.getUgraiData() || [];
            renderDashboard();
        } catch (error) {
            console.error('❌ Error loading UGRAI data only:', error);
        }
    }

    async loadUgraiEntriesOnly() {
        try {
            this.data.ugraiEntries = await this.supabaseService.getUgraiEntries() || [];
            renderDashboard();
        } catch (error) {
            console.error('❌ Error loading UGRAI entries only:', error);
        }
    }

    async loadCompletedUgraiOnly() {
        try {
            this.data.completedUgrai = await this.supabaseService.getCompletedUgrai() || [];
            renderDashboard();
        } catch (error) {
            console.error('❌ Error loading completed UGRAI only:', error);
        }
    }

    async loadPurchaseRetailersOnly() {
        try {
            this.data.purchaseRetailers = await this.supabaseService.getPurchaseRetailers() || [];
            renderDashboard();
        } catch (error) {
            console.error('❌ Error loading purchase retailers only:', error);
        }
    }

    async loadPurchaseEntriesOnly() {
        try {
            this.data.purchaseEntries = await this.supabaseService.getPurchaseEntries() || [];
            // Also update purchase tables specifically
            if (typeof enhancePurchaseTables === 'function') {
                enhancePurchaseTables();
            }
            renderDashboard();
        } catch (error) {
            console.error('❌ Error loading purchase entries only:', error);
        }
    }

    // Method to refresh all data from Supabase (useful for debugging persistence issues)
    async loadInitialData() {
        console.log('🔄 Refreshing all data from Supabase...');
        await this.loadSupabaseData();
        renderDashboard();
        console.log('✅ All data refreshed successfully');
    }

    // Manual cleanup method - only call when explicitly needed
    async runUgraiCleanup() {
        console.log('🧹 Running manual UGRAI cleanup...');
        try {
            if (typeof this.cleanupGhostBills === 'function') {
                const result = await this.cleanupGhostBills();
                console.log('✅ Manual UGRAI cleanup completed:', result);
                return result;
            }
        } catch (error) {
            console.error('❌ Manual UGRAI cleanup failed:', error);
            throw error;
        }
    }

    async checkExistingBills(billNumbers) {
        if (mockMode) {
            // In mock mode, check against local data
            const existingBills = [];
            const allBills = [
                ...this.data.temporaryBills,
                ...this.data.bills,
                ...this.data.activeSupplies,
                ...this.data.approvedBills
            ];

            billNumbers.forEach(billNumber => {
                const exists = allBills.some(bill =>
                    bill.billNumber === billNumber || bill.bill_number === billNumber
                );
                if (exists) {
                    existingBills.push(billNumber);
                }
            });

            return existingBills;
        }

        try {
            const existingBills = await this.supabaseService.checkExistingBillNumbers(billNumbers);
            return existingBills;
        } catch (error) {
            console.error('Error checking existing bills:', error);
            return []; // Return empty array on error to allow upload attempt
        }
    }

    async checkExistingRetailers(retailerNames) {
        if (mockMode) {
            // In mock mode, check against local data
            const existingRetailers = [];
            retailerNames.forEach(name => {
                const exists = this.data.retailers.some(retailer =>
                    retailer.name.toLowerCase().trim() === name.toLowerCase().trim()
                );
                if (exists) {
                    existingRetailers.push(name);
                }
            });
            return existingRetailers;
        }

        try {
            const existingRetailers = await this.supabaseService.checkExistingRetailerNames(retailerNames);
            return existingRetailers;
        } catch (error) {
            console.error('Error checking existing retailers:', error);
            return []; // Return empty array on error to allow upload attempt
        }
    }

    // Override retailer methods to use Supabase
    async addRetailer(name, sector) {
        if (mockMode) {
            return super.addRetailer(name, sector);
        }

        try {
            const exists = this.data.retailers.some(r =>
                String(r.name).toLowerCase().trim() === String(name).toLowerCase().trim()
            );

            if (!exists) {
                await this.supabaseService.addRetailer(name, sector);
                showToast(`✅ Retailer '${name}' added successfully!`, 'success');

                // Real-time update will happen via subscription, but refresh data to be sure
                await this.loadRetailers();
                return true;
            } else {
                showToast(`Retailer '${name}' already exists!`, 'warning');
                return false;
            }
        } catch (error) {
            console.error('Error adding retailer:', error);
            showToast('Error adding retailer: ' + (error.message || 'Unknown error'), 'error');
            return false;
        }
    }

    async setRetailers(newRetailers) {
        if (mockMode) {
            return super.setRetailers(newRetailers);
        }

        try {
            const formattedRetailers = newRetailers.map(r => ({
                retailer_name: r.name,
                sector: r.sector
            }));

            await this.supabaseService.bulkAddRetailers(formattedRetailers);
            showToast(`Uploaded ${newRetailers.length} retailers`);

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadRetailers();
        } catch (error) {
            console.error('Error setting retailers:', error);
            showToast('Error uploading retailers');
        }
    }

    async addRetailers(newRetailers) {
        if (mockMode) {
            return super.addRetailers(newRetailers);
        }

        try {
            const formattedRetailers = newRetailers.map(r => ({
                retailer_name: r.name,
                sector: r.sector
            }));

            const result = await this.supabaseService.bulkAddRetailers(formattedRetailers);

            console.log('✅ addRetailers result:', result);

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadRetailers();

            // Return the result object with addedCount
            return result;
        } catch (error) {
            console.error('Error adding retailers:', error);
            showToast('Error adding retailers');
            return { addedCount: 0, data: [] };
        }
    }

    async updateRetailer(id, newName, newSector, originalName) {
        if (mockMode) {
            const idx = (this.data.retailers || []).findIndex(r => 
                (id && r.id === id) || r.name.toLowerCase().trim() === originalName.toLowerCase().trim()
            );
            if (idx !== -1) {
                this.data.retailers[idx].name = newName;
                this.data.retailers[idx].sector = newSector;
            }
            showToast(`✅ Retailer "${newName}" updated successfully!`, 'success');
            return true;
        }

        try {
            console.log(`📝 Updating retailer id=${id}, name="${newName}", sector="${newSector}"`);
            
            // Check duplicate name if name changed
            if (newName.toLowerCase().trim() !== originalName.toLowerCase().trim()) {
                const conflict = (this.data.retailers || []).find(r => 
                    r.id !== id && r.name.toLowerCase().trim() === newName.toLowerCase().trim()
                );
                if (conflict) {
                    showToast(`Retailer "${newName}" already exists!`, 'warning');
                    return false;
                }
            }

            await this.supabaseService.updateRetailer(id, newName, newSector, originalName);

            // Update local state
            const idx = (this.data.retailers || []).findIndex(r => 
                (id && r.id === id) || r.name.toLowerCase().trim() === originalName.toLowerCase().trim()
            );
            if (idx !== -1) {
                this.data.retailers[idx].name = newName;
                this.data.retailers[idx].sector = newSector;
            }

            // Sync sectors across all bills
            await this.syncRetailerSectors(newName, newSector);
            showToast(`✅ Retailer "${newName}" updated successfully!`, 'success');
            return true;
        } catch (error) {
            console.error('Error in appState.updateRetailer:', error);
            showToast('Error updating retailer: ' + (error.message || 'Unknown error'), 'error');
            return false;
        }
    }

    async deleteRetailer(id, retailerName) {
        if (mockMode) {
            this.data.retailers = (this.data.retailers || []).filter(r => 
                !((id && r.id === id) || (r.name && r.name.toLowerCase().trim() === (retailerName || '').toLowerCase().trim()))
            );
            showToast(`✅ Retailer "${retailerName}" deleted successfully!`, 'success');
            return true;
        }

        try {
            console.log(`🗑️ Deleting retailer id=${id}, name="${retailerName}"`);
            await this.supabaseService.deleteRetailer(id, retailerName);

            // Remove from local data array
            this.data.retailers = (this.data.retailers || []).filter(r => 
                !((id && r.id === id) || (r.name && r.name.toLowerCase().trim() === (retailerName || '').toLowerCase().trim()))
            );

            showToast(`✅ Retailer "${retailerName}" deleted successfully!`, 'success');
            return true;
        } catch (error) {
            console.error('Error in appState.deleteRetailer:', error);
            showToast('Error deleting retailer: ' + (error.message || 'Unknown error'), 'error');
            return false;
        }
    }

    async deleteMultipleRetailers(retailerNames) {
        if (!retailerNames || retailerNames.length === 0) return true;

        if (mockMode) {
            const set = new Set(retailerNames.map(n => String(n).toLowerCase().trim()));
            this.data.retailers = (this.data.retailers || []).filter(r => !set.has(String(r.name).toLowerCase().trim()));
            showToast(`✅ ${retailerNames.length} retailers deleted successfully!`, 'success');
            return true;
        }

        try {
            console.log(`🗑️ Batch deleting ${retailerNames.length} retailers:`, retailerNames);
            await this.supabaseService.deleteMultipleRetailers(retailerNames);

            // Remove from local data array
            const set = new Set(retailerNames.map(n => String(n).toLowerCase().trim()));
            this.data.retailers = (this.data.retailers || []).filter(r => !set.has(String(r.name).toLowerCase().trim()));

            showToast(`✅ ${retailerNames.length} retailers deleted successfully!`, 'success');
            return true;
        } catch (error) {
            console.error('Error in appState.deleteMultipleRetailers:', error);
            showToast('Error deleting selected retailers: ' + (error.message || 'Unknown error'), 'error');
            return false;
        }
    }

    // Sync sectors across all bills when retailer sectors are updated
    async syncRetailerSectors(retailerName, newSector) {
        if (mockMode) {
            console.log(`📝 Mock mode: Syncing sector for ${retailerName} to ${newSector}`);
            // Update all bills in mock data
            const updateBillSector = (bills) => {
                if (!bills) return;
                bills.forEach(bill => {
                    if (String(bill.retailerName).toLowerCase().trim() === String(retailerName).toLowerCase().trim()) {
                        bill.sector = newSector;
                    }
                });
            };

            updateBillSector(this.data.temporaryBills);
            updateBillSector(this.data.bills);
            updateBillSector(this.data.activeSupplies);
            updateBillSector(this.data.ugraiData);
            updateBillSector(this.data.ugraiEntries);
            updateBillSector(this.data.ugraiInProgress);
            updateBillSector(this.data.completedUgrai);

            renderDashboard();
            return;
        }

        try {
            console.log(`🔄 Syncing sector for retailer "${retailerName}" to "${newSector}" across all tables...`);

            const updatedCount = await this.supabaseService.syncRetailerSectors(retailerName, newSector);

            console.log(`✅ Updated ${updatedCount} bill records with new sector`);

            // Reload all data to reflect changes
            await Promise.all([
                this.loadBills(),
                this.loadActiveSupplies(),
                this.loadUgraiData()
            ]);

            renderDashboard();

            return updatedCount;
        } catch (error) {
            console.error('Error syncing retailer sectors:', error);
            throw error;
        }
    }

    // Override to persist UGRAI assignments to database
    async moveAssignedBillsToInProgress() {
        if (mockMode) {
            return super.moveAssignedBillsToInProgress();
        }

        try {
            if (!this.data.ugraiInProgress) this.data.ugraiInProgress = [];

            const assignments = this.data.ugraiAssignments || {};
            const assignedSectors = Object.keys(assignments).filter(sector =>
                assignments[sector] && assignments[sector].trim() !== ''
            );

            console.log('🔄 Moving bills for assigned sectors to database:', assignedSectors);

            let totalMoved = 0;

            // Helper function to group bills by sector and move them
            const moveBillsBySector = async (bills, sourceTable) => {
                // Group bills by sector
                const billsBySector = {};
                bills.forEach(bill => {
                    const billSector = bill.sector || bill.Sector;
                    if (assignedSectors.includes(billSector)) {
                        if (!billsBySector[billSector]) {
                            billsBySector[billSector] = [];
                        }
                        billsBySector[billSector].push(bill);
                    }
                });

                // Move each sector's bills
                for (const sector of Object.keys(billsBySector)) {
                    const sectorBills = billsBySector[sector];
                    const billIds = sectorBills.map(b => b.id);
                    const assignedPerson = assignments[sector];

                    console.log(`📤 Moving ${billIds.length} bills from ${sourceTable} (sector: ${sector}) to in-progress (assigned to: ${assignedPerson})`);

                    const moved = await this.supabaseService.moveUgraiToInProgress(sourceTable, billIds, assignedPerson);
                    totalMoved += moved;
                }
            };

            // Process bills from ugrai_data table
            if (this.data.ugraiData && this.data.ugraiData.length > 0) {
                await moveBillsBySector(this.data.ugraiData, 'ugrai_data');
            }

            // Process bills from ugrai_entries table (from Supply credit/partial payments)
            if (this.data.ugraiEntries && this.data.ugraiEntries.length > 0) {
                await moveBillsBySector(this.data.ugraiEntries, 'ugrai_entries');
            }

            console.log(`✅ Successfully moved ${totalMoved} bills to database (ugrai_in_progress table)`);

            // Reload data to reflect database changes
            await this.loadUgraiInProgress();
            await this.loadUgraiDataOnly();
            await this.loadUgraiEntriesOnly();

            return totalMoved;

        } catch (error) {
            console.error('❌ Error moving assigned bills to in-progress:', error);
            showToast('Error moving bills to in-progress', 'error');
            throw error;
        }
    }

    // Override bill methods to use Supabase
    async addTemporaryBill(bill) {
        if (mockMode) {
            return super.addTemporaryBill(bill);
        }

        try {
            const formattedBill = {
                bill_number: bill.billNumber,
                bill_date: bill.billDate,
                retailer_name: bill.retailerName,
                net_amount: parseFloat(bill.netAmount),
                brand: bill.brand,
                sector: bill.sector
            };

            await this.supabaseService.addBillToStaging(formattedBill);
            showToast('Bill added to staging area!');

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadBills();
        } catch (error) {
            console.error('Error adding temporary bill:', error);
            showToast('Error adding bill');
        }
    }

    async removeTemporaryBill(billId) {
        if (mockMode) {
            return super.removeTemporaryBill(billId);
        }

        try {
            await this.supabaseService.removeBillFromStaging(billId);
            showToast('Bill removed from staging!');

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadBills();
        } catch (error) {
            console.error('Error removing temporary bill:', error);
            showToast('Error removing bill');
        }
    }

    async moveSelectedBillsToDispatch(billIds) {
        if (mockMode) {
            return super.moveSelectedBillsToDispatch(billIds);
        }

        try {
            const supplyThrough = 'Pending Assignment'; // Default value
            await this.supabaseService.moveBillsToDispatch(billIds, supplyThrough);
            showToast(`${billIds.length} bill(s) submitted to dispatch!`);

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadBills();
        } catch (error) {
            console.error('Error submitting bills:', error);
            showToast('Error submitting bills');
        }
    }

    async moveBillToActiveSupplies(billIds, supplyThrough) {
        console.log('🎯 moveBillToActiveSupplies called with:', { billIds, supplyThrough });

        if (mockMode) {
            return super.moveBillToActiveSupplies(billIds, supplyThrough);
        }

        try {
            console.log('📞 Calling supabaseService.moveToActiveSupplies with:', billIds);
            await this.supabaseService.moveToActiveSupplies(billIds);
            showToast(`${billIds.length} bill(s) moved to supplies`);
            console.log('✅ Bills successfully moved to active supplies');

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadBills();
            await this.loadActiveSupplies();
        } catch (error) {
            console.error('❌ Error moving bills to active supplies:', error);
            showToast('Error moving bills');
        }
    }

    async moveBillToActiveSuppliesWithAssignments(billsData) {
        console.log('🎯 moveBillToActiveSuppliesWithAssignments called with:', billsData);

        if (mockMode) {
            // For mock mode, convert to the old format and use existing method
            const billIds = billsData.map(b => b.billId);
            const supplyThrough = billsData[0]?.supplyThrough || 'Pending Assignment';
            return super.moveBillToActiveSupplies(billIds, supplyThrough);
        }

        try {
            // Process each bill with its individual supply through assignment
            console.log('📞 Calling supabaseService.moveToActiveSuppliesWithAssignments with:', billsData);
            await this.supabaseService.moveToActiveSuppliesWithAssignments(billsData);
            showToast(`${billsData.length} bill(s) moved to supplies with assignments`);
            console.log('✅ Bills successfully moved to active supplies with individual assignments');

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadBills();
            await this.loadActiveSupplies();
        } catch (error) {
            console.error('❌ Error moving bills to active supplies with assignments:', error);
            showToast('Error moving bills with assignments');
        }
    }

    async updateSupplyStatus(billNumber, updates) {
        if (mockMode) {
            return super.updateSupplyStatus(billNumber, updates);
        }

        try {
            // Find the supply by bill number
            const supply = this.data.activeSupplies.find(s => s.billNumber === billNumber);
            if (!supply) {
                showToast('Supply not found');
                return;
            }

            // Handle different status updates
            if (updates.status === 'Edited') {
                // Ensure retailer_name is set
                if (!supply.retailer_name) {
                    supply.retailer_name = supply.retailerName || supply.retailer || 'Unknown';
                }
                // Save to edited_bills table in database
                await this.supabaseService.addEditedBill(
                    supply,
                    supply.netAmount,
                    supply.netAmount,
                    'Bill marked as edited for correction'
                );
                // Remove from active_supplies table (no longer active)
                await this.supabaseService.removeActiveSupply(supply.id);
                // Move to edited bills in local data with additional tracking fields
                const localBillIndex = this.data.activeSupplies.findIndex(b => b.billNumber === billNumber);
                if (localBillIndex !== -1) {
                    const localBill = this.data.activeSupplies[localBillIndex];
                    this.data.activeSupplies.splice(localBillIndex, 1);
                    this.data.editedBills.push({
                        ...localBill,
                        ...updates,
                        editedAmount: localBill.netAmount,
                        originalAmount: localBill.netAmount
                    });
                }
                console.log(`Bill ${billNumber} moved to edited bills for supply management`);
                console.log('📊 Current edited bills after move:', this.data.editedBills.length);
                showToast('Bill marked as edited and moved to edited bills section', 'success');
            } else {
                // For other statuses like 'Completed', update the supply
                const completionData = {
                    status: updates.status,
                    paymentMethod: updates.deliveryMethod,
                    receiptNumber: updates.receiptNumber,
                    receivedAmount: updates.receivedAmount,
                    chequeDate: updates.chequeDate === '' ? null : updates.chequeDate,
                    photoUrl: updates.photoUrl
                };

                console.log(`🔄 [updateSupplyStatus] Updating supply ${billNumber} (ID: ${supply.id}) to status: ${updates.status}`);
                await this.supabaseService.completeSupply(supply.id, completionData);
                console.log(`✅ [updateSupplyStatus] Supply ${billNumber} status updated to ${updates.status}`);
            }

            // Real-time update will happen via subscription, but refresh data to be sure
            console.log('🔄 [updateSupplyStatus] Reloading active supplies and edited bills...');
            await this.loadActiveSupplies();
            await this.loadEditedBills();

            // Force load edited bills UI even if not currently visible
            loadEditedBills();

            renderDashboard();
            console.log('✅ [updateSupplyStatus] Dashboard refreshed');

        } catch (error) {
            console.error('❌ [updateSupplyStatus] Error updating supply status:', error);
            console.error('❌ [updateSupplyStatus] Error message:', error.message);
            showToast(`Error updating supply: ${error.message}`, 'error');
        }
    }

    async moveBackToBills(billId) {
        if (mockMode) {
            return super.moveBackToBills(billId);
        }

        try {
            console.log('Moving bill back to staging:', billId);

            await this.supabaseService.moveBillsBackToStaging([billId]);
            showToast('Bill moved back to staging');

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadBills();
        } catch (error) {
            console.error('Error moving bill back:', error);
            showToast('Error moving bill back');
        }
    }

    async approveBill(billNumber) {
        console.log('🎯 approveBill called with bill number:', billNumber);

        if (mockMode) {
            return super.approveBill(billNumber);
        }

        try {
            // Find the supply by bill number
            const supply = this.data.activeSupplies.find(s => s.billNumber === billNumber);
            if (!supply) {
                showToast('Bill not found');
                console.warn('❌ Bill not found:', billNumber);
                return;
            }

            console.log('📋 Found supply to approve:', supply);

            // Approve the single supply using the existing approveBills method
            await this.supabaseService.approveSupplies([supply.id]);
            showToast(`Bill ${billNumber} approved and sent to approved bills`);
            console.log('✅ Bill approved successfully');

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadActiveSupplies();
            await this.loadApprovedBills();
            await this.loadUgraiEntriesOnly(); // Reload UGRAI entries for credit/partial bills

            renderDashboard();
        } catch (error) {
            console.error('❌ Error approving bill:', error);
            showToast('Error approving bill');
        }
    }

    async approveSelectedBills(billNumbers) {
        console.log('🎯 approveSelectedBills called with bill numbers:', billNumbers);

        if (mockMode) {
            return super.approveSelectedBills(billNumbers);
        }

        try {
            // Find supplies by bill numbers
            const suppliesToApprove = this.data.activeSupplies.filter(s => billNumbers.includes(s.billNumber));
            if (suppliesToApprove.length === 0) {
                showToast('No bills found to approve');
                console.warn('❌ No bills found for approval:', billNumbers);
                return;
            }

            console.log('📋 Found supplies to approve:', suppliesToApprove);

            // Get supply IDs for the approval
            const supplyIds = suppliesToApprove.map(s => s.id);

            // Approve the supplies using the existing service method
            await this.supabaseService.approveSupplies(supplyIds);
            showToast(`${billNumbers.length} bills approved and sent to approved bills`);
            console.log('✅ Bills approved successfully');

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadActiveSupplies();
            await this.loadApprovedBills();
            await this.loadUgraiEntriesOnly(); // Reload UGRAI entries for credit/partial bills

            renderDashboard();
        } catch (error) {
            console.error('❌ Error approving selected bills:', error);
            showToast('Error approving bills');
        }
    }

    async approveBills(billIds) {
        if (mockMode) {
            // Mock mode implementation
            const billsToApprove = this.data.activeSupplies.filter(bill =>
                billIds.includes(bill.id) &&
                ['Delivered', 'Cancelled', 'Edited'].includes(bill.status)
            );

            billsToApprove.forEach(bill => {
                this.data.approvedBills.push({ ...bill, approvalDate: new Date().toISOString() });
            });

            this.data.activeSupplies = this.data.activeSupplies.filter(bill => !billIds.includes(bill.id));
            renderDashboard();
            showToast(`${billsToApprove.length} bill(s) approved!`);
            return;
        }

        try {
            await this.supabaseService.approveSupplies(billIds);
            showToast(`${billIds.length} bill(s) approved!`);

            // Real-time update will happen via subscription, but refresh data to be sure
            await this.loadActiveSupplies();
            await this.loadApprovedBills();
            await this.loadUgraiEntriesOnly(); // Reload UGRAI entries for credit/partial bills

            renderDashboard();
        } catch (error) {
            console.error('Error approving bills:', error);
            showToast('Error approving bills');
        }
    }

    // Cleanup method
    destroy() {
        this.subscriptions.forEach(subscription => {
            if (subscription && subscription.unsubscribe) {
                subscription.unsubscribe();
            }
        });
        this.subscriptions = [];
    }
}

function showToast(message, type = 'info', duration = 3000) {
    console.log(`Toast called: ${type} - ${message}`);

    if (!toastMessage) {
        console.error('Toast element not found! Trying to find it...');
        toastMessage = document.getElementById('toast-message');
    }

    if (toastMessage) {
        toastMessage.textContent = message;

        // Remove all type classes
        toastMessage.classList.remove('bg-red-600', 'bg-yellow-600', 'bg-green-600', 'bg-blue-600');

        // Add appropriate color based on type
        switch (type) {
            case 'error':
                toastMessage.classList.add('bg-red-600');
                console.log('Applied error styling (red background)');
                break;
            case 'warning':
                toastMessage.classList.add('bg-yellow-600');
                console.log('Applied warning styling (yellow background)');
                break;
            case 'success':
                toastMessage.classList.add('bg-green-600');
                console.log('Applied success styling (green background)');
                break;
            default:
                toastMessage.classList.add('bg-blue-600');
                console.log('Applied info styling (blue background)');
        }

        toastMessage.classList.remove('translate-y-24', 'opacity-0');
        toastMessage.classList.add('translate-y-0', 'opacity-100');

        console.log(`Toast displayed for ${duration}ms`);

        setTimeout(() => {
            toastMessage.classList.remove('translate-y-0', 'opacity-100');
            toastMessage.classList.add('translate-y-24', 'opacity-0');
            console.log('Toast hidden');
        }, duration);
    } else {
        console.error('Toast element still not found! Message was:', message);
        // Fallback to alert if toast is not available
        alert(`${type.toUpperCase()}: ${message}`);
    }
}

// Load photos from bill_photos table for Supply Management
async function loadSupplyManagementPhotos(bills) {
    console.log(`📸 Loading photos for ${bills.length} bills from bill_photos table...`);

    for (const bill of bills) {
        try {
            // Get photo cell element
            const photoCell = document.querySelector(`.supply-photo-cell[data-bill-number="${bill.billNumber}"]`);
            if (!photoCell) continue;

            // Fetch photos from bill_photos table
            const photos = await getBillPhotos(bill.billNumber, 'supply');

            if (photos && photos.length > 0) {
                const photoUrl = photos[0].photo_url; // Get most recent photo

                // Replace loading spinner with photo thumbnail
                photoCell.innerHTML = `
                    <img src="${photoUrl}" 
                         alt="Bill Photo" 
                         class="supply-bill-photo-thumbnail w-16 h-16 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity mx-auto" 
                         data-photo-url="${photoUrl}"
                         data-bill-number="${bill.billNumber}"
                         onclick="openSupplyPhotoModal('${photoUrl}', '${bill.billNumber}')">
                `;

                console.log(`✅ Loaded photo for bill ${bill.billNumber}`);
            } else {
                // No photo found - show "No Photo" message
                photoCell.innerHTML = `<span class="text-gray-400 text-xs">No Photo</span>`;
            }
        } catch (error) {
            console.error(`❌ Error loading photo for bill ${bill.billNumber}:`, error);
            // Show error state
            const photoCell = document.querySelector(`.supply-photo-cell[data-bill-number="${bill.billNumber}"]`);
            if (photoCell) {
                photoCell.innerHTML = `<span class="text-gray-400 text-xs">No Photo</span>`;
            }
        }
    }

    console.log('✅ Finished loading all Supply Management photos');
}

// Load photos from bill_photos table for UGRAI Management
async function loadUgraiManagementPhotos(bills) {
    console.log(`📸 Loading UGRAI photos for ${bills.length} bills from bill_photos table...`);

    for (const bill of bills) {
        try {
            // Get photo cell element
            const photoCell = document.querySelector(`.ugrai-photo-cell[data-bill-number="${bill.billNumber}"]`);
            if (!photoCell) continue;

            // Fetch photos from bill_photos table (try both 'ugrai' and 'supply' source types)
            let photos = await getBillPhotos(bill.billNumber, 'ugrai');

            // If no photos found with 'ugrai' source, try 'supply' (since ugrai bills come from supplies)
            if (!photos || photos.length === 0) {
                photos = await getBillPhotos(bill.billNumber, 'supply');
            }

            if (photos && photos.length > 0) {
                const photoUrl = photos[0].photo_url; // Get most recent photo

                // Replace loading spinner with photo thumbnail
                photoCell.innerHTML = `
                    <img src="${photoUrl}" 
                         alt="Bill Photo" 
                         class="ugrai-bill-photo-thumbnail w-16 h-16 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity mx-auto" 
                         data-photo-url="${photoUrl}"
                         data-bill-number="${bill.billNumber}"
                         onclick="openUgraiPhotoModal('${photoUrl}', '${bill.billNumber}')">
                `;

                console.log(`✅ Loaded UGRAI photo for bill ${bill.billNumber}`);
            } else {
                // No photo found - show "No Photo" message
                photoCell.innerHTML = `<span class="text-gray-400 text-xs">No Photo</span>`;
            }
        } catch (error) {
            console.error(`❌ Error loading UGRAI photo for bill ${bill.billNumber}:`, error);
            // Show error state
            const photoCell = document.querySelector(`.ugrai-photo-cell[data-bill-number="${bill.billNumber}"]`);
            if (photoCell) {
                photoCell.innerHTML = `<span class="text-gray-400 text-xs">No Photo</span>`;
            }
        }
    }

    console.log('✅ Finished loading all UGRAI Management photos');
}

// Open Supply Bill Photo Modal
window.openSupplyPhotoModal = function (photoUrl, billNumber) {
    console.log('📸 Opening supply photo modal:', billNumber);

    const modal = document.getElementById('supply-photo-modal');
    const modalImage = document.getElementById('supply-photo-modal-image');
    const billNumberSpan = document.getElementById('supply-photo-bill-number');
    const downloadLink = document.getElementById('supply-photo-download-link');

    console.log('🔍 Modal elements:', {
        modal: !!modal,
        modalImage: !!modalImage,
        billNumberSpan: !!billNumberSpan,
        downloadLink: !!downloadLink
    });

    if (modal && modalImage && billNumberSpan && downloadLink) {
        modalImage.src = photoUrl;
        billNumberSpan.textContent = billNumber;
        downloadLink.href = photoUrl;
        downloadLink.download = `bill-${billNumber}-photo.jpg`;

        // Force parent containers to be visible (modal might be in hidden supply dashboard)
        let parent = modal.parentElement;
        const parentInfo = [];
        while (parent && parent !== document.body) {
            const computedDisplay = window.getComputedStyle(parent).display;
            parentInfo.push({
                id: parent.id || 'no-id',
                className: parent.className || 'no-class',
                styleDisplay: parent.style.display,
                computedDisplay: computedDisplay
            });

            if (computedDisplay === 'none' || parent.style.display === 'none') {
                parent.setAttribute('data-forced-visible', 'true');
                parent.style.setProperty('display', 'block', 'important');
            }
            parent = parent.parentElement;
        }

        console.log('📦 Parent containers:', parentInfo);

        // Remove hidden class and force visibility with !important equivalent
        modal.classList.remove('hidden');
        modal.style.setProperty('display', 'flex', 'important');
        modal.style.setProperty('position', 'fixed', 'important');
        modal.style.setProperty('inset', '0', 'important');
        modal.style.setProperty('z-index', '9999', 'important');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling

        console.log('✅ Modal opened successfully', {
            modalDisplay: window.getComputedStyle(modal).display,
            modalPosition: window.getComputedStyle(modal).position,
            modalZIndex: window.getComputedStyle(modal).zIndex
        });
    } else {
        console.error('❌ Supply photo modal elements not found:', {
            modal: !!modal,
            modalImage: !!modalImage,
            billNumberSpan: !!billNumberSpan,
            downloadLink: !!downloadLink
        });
        showToast('Error opening photo preview', 'error');
    }
};

// Close Supply Bill Photo Modal
window.closeSupplyPhotoModal = function (event) {
    // Only close if clicking the backdrop or close button
    if (!event || event.target.id === 'supply-photo-modal') {
        const modal = document.getElementById('supply-photo-modal');
        const image = document.getElementById('supply-photo-modal-image');

        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = ''; // Restore scrolling

            // Restore parent containers that were forced visible
            let parent = modal.parentElement;
            while (parent && parent !== document.body) {
                if (parent.getAttribute('data-forced-visible') === 'true') {
                    parent.style.display = 'none';
                    parent.removeAttribute('data-forced-visible');
                }
                parent = parent.parentElement;
            }

            // Reset zoom state
            if (image) {
                image.classList.remove('scale-150', 'cursor-zoom-out');
                image.classList.add('cursor-zoom-in');
            }
        }
    }
};

// Toggle image zoom in fullscreen modal
window.toggleImageZoom = function (event) {
    event.stopPropagation(); // Prevent closing modal

    const image = event.target;

    if (image.classList.contains('scale-150')) {
        // Zoom out
        image.classList.remove('scale-150', 'cursor-zoom-out');
        image.classList.add('cursor-zoom-in');
    } else {
        // Zoom in
        image.classList.add('scale-150', 'cursor-zoom-out');
        image.classList.remove('cursor-zoom-in');
    }
};

// Keyboard support for closing modal with Escape key
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('supply-photo-modal');
        if (modal && !modal.classList.contains('hidden')) {
            closeSupplyPhotoModal();
        }
        const ugraiModal = document.getElementById('ugrai-photo-modal');
        if (ugraiModal && !ugraiModal.classList.contains('hidden')) {
            closeUgraiPhotoModal();
        }
    }
});

// ========================================
// UGRAI PHOTO MODAL FUNCTIONS
// ========================================

// Open UGRAI Bill Photo Modal
window.openUgraiPhotoModal = function (photoUrl, billNumber) {
    console.log('📸 Opening UGRAI photo modal:', billNumber);

    const modal = document.getElementById('ugrai-photo-modal');
    const modalImage = document.getElementById('ugrai-photo-modal-image');
    const billNumberSpan = document.getElementById('ugrai-photo-bill-number');
    const downloadLink = document.getElementById('ugrai-photo-download-link');

    console.log('🔍 Modal elements:', {
        modal: !!modal,
        modalImage: !!modalImage,
        billNumberSpan: !!billNumberSpan,
        downloadLink: !!downloadLink
    });

    if (modal && modalImage && billNumberSpan && downloadLink) {
        modalImage.src = photoUrl;
        billNumberSpan.textContent = billNumber;
        downloadLink.href = photoUrl;
        downloadLink.download = `ugrai-bill-${billNumber}-photo.jpg`;

        // Force parent containers to be visible (modal might be in hidden dashboard)
        let parent = modal.parentElement;
        const parentInfo = [];
        while (parent && parent !== document.body) {
            const computedDisplay = window.getComputedStyle(parent).display;
            parentInfo.push({
                id: parent.id || 'no-id',
                className: parent.className || 'no-class',
                styleDisplay: parent.style.display,
                computedDisplay: computedDisplay
            });

            if (computedDisplay === 'none' || parent.style.display === 'none') {
                parent.setAttribute('data-forced-visible', 'true');
                parent.style.setProperty('display', 'block', 'important');
            }
            parent = parent.parentElement;
        }

        console.log('📦 Parent containers:', parentInfo);

        // Remove hidden class and force visibility with !important equivalent
        modal.classList.remove('hidden');
        modal.style.setProperty('display', 'flex', 'important');
        modal.style.setProperty('position', 'fixed', 'important');
        modal.style.setProperty('inset', '0', 'important');
        modal.style.setProperty('z-index', '9999', 'important');
        document.body.style.overflow = 'hidden'; // Prevent background scrolling

        console.log('✅ UGRAI modal opened successfully', {
            modalDisplay: window.getComputedStyle(modal).display,
            modalPosition: window.getComputedStyle(modal).position,
            modalZIndex: window.getComputedStyle(modal).zIndex
        });
    } else {
        console.error('❌ UGRAI photo modal elements not found:', {
            modal: !!modal,
            modalImage: !!modalImage,
            billNumberSpan: !!billNumberSpan,
            downloadLink: !!downloadLink
        });
        showToast('Error opening photo preview', 'error');
    }
};

// Close UGRAI Bill Photo Modal
window.closeUgraiPhotoModal = function (event) {
    // Only close if clicking the backdrop or close button
    if (!event || event.target.id === 'ugrai-photo-modal') {
        const modal = document.getElementById('ugrai-photo-modal');
        const image = document.getElementById('ugrai-photo-modal-image');

        if (modal) {
            modal.classList.add('hidden');
            document.body.style.overflow = ''; // Restore scrolling

            // Restore parent containers that were forced visible
            let parent = modal.parentElement;
            while (parent && parent !== document.body) {
                if (parent.getAttribute('data-forced-visible') === 'true') {
                    parent.removeAttribute('data-forced-visible');
                    parent.style.removeProperty('display');
                }
                parent = parent.parentElement;
            }

            // Reset image zoom
            if (image) {
                image.style.transform = '';
                image.classList.add('cursor-zoom-in');
                image.classList.remove('cursor-zoom-out');
            }
        }
    }
};

// Load assignees from database
async function loadAssigneesFromDatabase() {
    console.log('🚀 loadAssigneesFromDatabase called');
    try {
        // Wait a bit for supabase client to be initialized
        let attempts = 0;
        while (!window.supabase && attempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }

        if (!window.supabase) {
            console.log('⚠️ Supabase library not loaded after waiting');
            return;
        }

        // Supabase configuration
        const supabaseUrl = 'dls-sheets-backend';
        const supabaseKey = 'not-needed';

        const supabaseClient = window.supabase.createClient(
            supabaseUrl,
            supabaseKey,
            {
                auth: {
                    persistSession: true,
                    autoRefreshToken: true,
                    detectSessionInUrl: true,
                    storage: window.localStorage,
                    flowType: 'pkce'
                }
            }
        );
        console.log('✅ Supabase client created');

        // Fetch supply assignees (users with supply_in_progress role)
        const { data: supplyRole, error: supplyRoleError } = await supabaseClient
            .from('roles')
            .select('id')
            .eq('name', 'supply_in_progress')
            .single();

        if (!supplyRoleError && supplyRole) {
            const { data: supplyUserRoles } = await supabaseClient
                .from('user_roles')
                .select('user_id')
                .eq('role_id', supplyRole.id);

            if (supplyUserRoles && supplyUserRoles.length > 0) {
                const supplyUserIds = supplyUserRoles.map(ur => ur.user_id);
                const { data: supplyProfiles } = await supabaseClient
                    .from('user_profiles')
                    .select('user_id, full_name, email')
                    .in('user_id', supplyUserIds);

                if (supplyProfiles) {
                    appState.data.supplyAssignees = supplyProfiles;
                    console.log('✅ Loaded supply assignees:', supplyProfiles.length, supplyProfiles);
                }
            }
        }

        // Fetch UGRAI assignees (users with ugrai_in_progress role)
        const { data: ugraiRole, error: ugraiRoleError } = await supabaseClient
            .from('roles')
            .select('id')
            .eq('name', 'ugrai_in_progress')
            .single();

        if (!ugraiRoleError && ugraiRole) {
            const { data: ugraiUserRoles } = await supabaseClient
                .from('user_roles')
                .select('user_id')
                .eq('role_id', ugraiRole.id);

            if (ugraiUserRoles && ugraiUserRoles.length > 0) {
                const ugraiUserIds = ugraiUserRoles.map(ur => ur.user_id);
                const { data: ugraiProfiles } = await supabaseClient
                    .from('user_profiles')
                    .select('user_id, full_name, email')
                    .in('user_id', ugraiUserIds);

                if (ugraiProfiles) {
                    appState.data.ugraiAssignees = ugraiProfiles;
                    // Also update persons array for backward compatibility
                    appState.data.persons = ugraiProfiles.map(p => p.full_name);
                    console.log('✅ Loaded UGRAI assignees:', ugraiProfiles.length, ugraiProfiles);
                }
            }
        }

        // After loading, trigger re-renders if sections are visible
        console.log('✅ Assignees loaded, triggering re-renders...');

        // Re-render supply dashboard if it's visible
        const supplyDashboard = document.getElementById('supply-dashboard-container');
        if (supplyDashboard && !supplyDashboard.classList.contains('hidden')) {
            console.log('Re-rendering supply dashboard with new assignees');
            renderDashboard();
        }

        // Re-render UGRAI sector totals if it's visible
        const ugraiDashboard = document.getElementById('ugrai-dashboard-container');
        if (ugraiDashboard && !ugraiDashboard.classList.contains('hidden')) {
            console.log('Re-rendering UGRAI sector totals with new assignees');
            if (typeof renderSectorTotalsTable === 'function') {
                await renderSectorTotalsTable();
            }
        }

    } catch (error) {
        console.error('Error loading assignees from database:', error);
    }
}

function initUgraiFunctionality() {
    console.log("Initializing Ugrai Functionality...");

    // Data structures are already initialized in AppState constructor
    // Just ensure they exist (defensive programming)
    if (!appState.data.ugraiData) appState.data.ugraiData = [];
    if (!appState.data.ugraiEntries) appState.data.ugraiEntries = [];
    if (!appState.data.persons) appState.data.persons = ['Mohan', 'Suresh', 'Rahul'];
    if (!appState.data.ugraiAssignments) appState.data.ugraiAssignments = {};
    if (!appState.data.supplyAssignees) appState.data.supplyAssignees = [];
    if (!appState.data.ugraiAssignees) appState.data.ugraiAssignees = [];

    // Load assignees and processed Total UGRAI data from database
    Promise.all([
        loadAssigneesFromDatabase(),
        loadProcessedTotalUgrai()
    ]).then(() => {
        console.log("Ugrai Functionality initialized successfully with processed Total UGRAI data!");
        renderDashboard();
    }).catch(err => {
        console.error("Error initializing Ugrai functionality:", err);
        renderDashboard(); // Still render dashboard even if data load fails
    });
}

function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('opacity-0', 'pointer-events-none');
    }
}

// Logout functionality
async function handleLogout() {
    try {
        console.log('Starting logout process...');

        // Clear all local storage data
        localStorage.clear();
        sessionStorage.clear();

        // Set logout flag
        localStorage.setItem('logout_flag', 'true');

        // If we have Supabase configuration, sign out from Supabase
        if (window.__supabase_url && window.__supabase_anon_key && window.supabase) {
            try {
                const supabase = window.supabase.createClient(
                    window.__supabase_url,
                    window.__supabase_anon_key,
                    {
                        auth: {
                            persistSession: true,
                            autoRefreshToken: true,
                            detectSessionInUrl: true,
                            storage: window.localStorage,
                            flowType: 'pkce'
                        }
                    }
                );
                const { error } = await supabase.auth.signOut();
                if (error) {
                    console.error('Supabase logout error:', error);
                } else {
                    console.log('Successfully logged out from Supabase');
                }
            } catch (supabaseError) {
                console.error('Error during Supabase logout:', supabaseError);
            }
        }

        // If using Supabase service, sign out from Supabase
        if (supabaseService && typeof supabaseService.signOut === 'function') {
            await supabaseService.signOut();
        }

        // If using Firebase, sign out from Firebase
        if (auth && auth.signOut) {
            await auth.signOut();
        }

        console.log('Logout completed, redirecting...');

        // Show logout success message and redirect
        Swal.fire({
            icon: 'success',
            title: 'Logged Out!',
            text: 'You have been logged out successfully.',
            timer: 1000,
            showConfirmButton: false
        }).then(() => {
            // Force redirect to login page
            window.location.replace('login.html');
        });

    } catch (error) {
        console.error('Logout error:', error);

        // Even if logout fails, clear everything and redirect
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('logout_flag', 'true');

        Swal.fire({
            icon: 'info',
            title: 'Logged Out',
            text: 'You have been logged out.',
            timer: 1000,
            showConfirmButton: false
        }).then(() => {
            window.location.replace('login.html');
        });
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('opacity-0', 'pointer-events-none');
    }
}

function downloadCSV(filename, text) {
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    showToast(`Downloaded ${filename}`);
}

function generateCashBillNumber() {
    const randomNumber = Math.floor(1000 + Math.random() * 9000);
    return `Cash-${randomNumber}`;
}

// Generate unique bill number with duplicate checking
async function generateUniqueBillNumber() {
    let attempts = 0;
    const maxAttempts = 50; // Prevent infinite loop

    while (attempts < maxAttempts) {
        const billNumber = generateCashBillNumber();

        try {
            // Check if this bill number already exists
            const existingBills = await appState.checkExistingBills([billNumber]);

            if (existingBills.length === 0) {
                // Bill number is unique, use it
                if (billNumberInput) {
                    billNumberInput.value = billNumber;
                    console.log('Generated unique bill number:', billNumber);
                }
                return billNumber;
            }

            attempts++;
            console.log(`Bill number ${billNumber} already exists, trying again... (attempt ${attempts})`);

        } catch (error) {
            console.error('Error checking bill number uniqueness:', error);
            // If error checking, just use the generated number
            if (billNumberInput) {
                billNumberInput.value = billNumber;
            }
            return billNumber;
        }
    }

    // If we couldn't generate a unique number after max attempts, use timestamp
    const fallbackNumber = `Cash-${Date.now().toString().slice(-4)}`;
    if (billNumberInput) {
        billNumberInput.value = fallbackNumber;
    }
    console.warn('Used fallback bill number after max attempts:', fallbackNumber);
    return fallbackNumber;
}

// Function to initialize the UGRAI dashboard
function initializeUgraiDashboard() {
    console.log("Initializing Ugrai Dashboard...");

    // Get the ugrai base file content
    const ugraiBaseFile = document.getElementById('ugrai-base-file');
    if (ugraiBaseFile) {
        // Keep the existing title
        const title = ugraiBaseFile.querySelector('h3');
        const titleHTML = title ? title.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai Base File</h3>';

        // Set the content
        ugraiBaseFile.innerHTML = titleHTML;
        const baseFileContent = createUgraiBaseFileContent();
        ugraiBaseFile.appendChild(baseFileContent);
    }

    // Get the ugrai issue content
    const ugraiIssue = document.getElementById('ugrai-issue');
    if (ugraiIssue) {
        // Keep the existing title
        const title = ugraiIssue.querySelector('h3');
        const titleHTML = title ? title.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai Issue</h3>';

        // Set the content
        ugraiIssue.innerHTML = titleHTML;
        const issueContent = createUgraiIssueContent();
        ugraiIssue.appendChild(issueContent);
    }

    // Get the ugrai in progress content
    const ugraiInProgress = document.getElementById('ugrai-in-progress');
    const staticTable = document.getElementById('ugrai-progress-table');

    // Only create dynamic content if static HTML structure doesn't exist
    if (ugraiInProgress && !staticTable) {
        // Keep the existing title
        const title = ugraiInProgress.querySelector('h3');
        const titleHTML = title ? title.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai in Progress</h3>';

        // Set the content
        ugraiInProgress.innerHTML = titleHTML;
        const inProgressContent = createUgraiInProgressContent();
        ugraiInProgress.appendChild(inProgressContent);
    }

    // Initialize default persons if not set yet
    if (mockMode && (!appState.data.persons || appState.data.persons.length === 0)) {
        console.log("Initializing default persons");
        appState.data.persons = ['Mohan', 'Suresh', 'Rahul'];
    }

    console.log("Ugrai Dashboard initialized successfully");
}
// Explicitly populate all Ugrai tab content
function populateAllUgraiTabs() {
    console.log("Populating all Ugrai tabs...");

    // 1. Ugrai Base File tab
    const baseFileTab = document.getElementById('ugrai-base-file');
    if (baseFileTab) {
        // Preserve the header
        const header = baseFileTab.querySelector('h3');
        const headerHTML = header ? header.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai Base File</h3>';
        baseFileTab.innerHTML = headerHTML;

        // Add content
        baseFileTab.appendChild(createUgraiBaseFileContent());
    }

    // 1.5 Total Ugrai tab (New separate tab)
    const totalUgraiTab = document.getElementById('total-ugrai');
    if (totalUgraiTab) {
        // Preserve the header
        const header = totalUgraiTab.querySelector('h3');
        const headerHTML = header ? header.outerHTML : '<h3 class="text-lg font-bold mb-4">Total Ugrai</h3>';
        totalUgraiTab.innerHTML = headerHTML;

        // Add content
        totalUgraiTab.appendChild(createTotalUgraiContent());
    }

    // 2. Ugrai Issue tab
    const issueTab = document.getElementById('ugrai-issue');
    if (issueTab) {
        // Preserve the header
        const header = issueTab.querySelector('h3');
        const headerHTML = header ? header.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai Issue</h3>';
        issueTab.innerHTML = headerHTML;

        // Add content
        issueTab.appendChild(createUgraiIssueContent());
    }

    // 3. Ugrai In Progress tab
    const inProgressTab = document.getElementById('ugrai-in-progress');
    const staticTable = document.getElementById('ugrai-progress-table');

    // Only create dynamic content if static HTML structure doesn't exist
    if (inProgressTab && !staticTable) {
        // Preserve the header
        const header = inProgressTab.querySelector('h3');
        const headerHTML = header ? header.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai In Progress</h3>';
        inProgressTab.innerHTML = headerHTML;

        // Add content
        inProgressTab.appendChild(createUgraiInProgressContent());
    }

    // 4. Ugrai Management tab
    // 4. Ugrai Management tab
    const managementTab = document.getElementById('ugrai-management');
    if (managementTab) {
        // Clear existing content (keep header)
        const header = managementTab.querySelector('h3');
        const headerHTML = header ? header.outerHTML : '<h3 class="text-lg font-bold mb-4">Ugrai Management</h3>';
        managementTab.innerHTML = headerHTML;

        // Add combined cards and filters section
        const cardsAndFiltersSection = document.createElement('div');
        cardsAndFiltersSection.className = 'flex flex-col lg:flex-row gap-4 mb-4';

        // Add summary cards section
        const summaryCardsSection = document.createElement('div');
        summaryCardsSection.className = 'flex flex-wrap gap-2 overflow-x-auto lg:flex-1';
        summaryCardsSection.innerHTML = `
            <!-- Combined Total Bills & Amount Card -->
            <div id="ugrai-total-overview-card"
                class="report-summary-card min-w-[160px] flex-shrink-0 cursor-pointer"
                data-filter-method="all">
                <p class="text-xs font-medium text-gray-500 mb-1">Pending Approval</p>
                <div class="flex items-center justify-between">
                    <div>
                        <p class="text-lg font-bold text-gray-800" id="ugrai-total-bills-count">0</p>
                        <p class="text-xs text-gray-600">Bills</p>
                    </div>
                    <div class="text-right">
                        <p class="text-lg font-bold text-gray-800" id="ugrai-total-received-amount">₹0.00</p>
                        <p class="text-xs text-gray-600">Amount</p>
                    </div>
                </div>
            </div>

            <!-- Cash Card -->
            <div id="ugrai-cash-amount-card"
                class="report-summary-card min-w-[120px] flex-shrink-0 cursor-pointer"
                data-filter-method="Cash">
                <p class="text-xs font-medium text-gray-500 mb-1">Cash</p>
                <p class="text-sm font-bold text-green-600" id="ugrai-cash-received">₹0.00</p>
                <p class="text-xs text-gray-600" id="ugrai-cash-count">(0)</p>
            </div>

            <!-- UPI Card -->
            <div id="ugrai-upi-amount-card"
                class="report-summary-card min-w-[120px] flex-shrink-0 cursor-pointer"
                data-filter-method="UPI">
                <p class="text-xs font-medium text-gray-500 mb-1">UPI</p>
                <p class="text-sm font-bold text-purple-600" id="ugrai-upi-received">₹0.00</p>
                <p class="text-xs text-gray-600" id="ugrai-upi-count">(0)</p>
            </div>

            <!-- Cheque Card -->
            <div id="ugrai-cheque-amount-card"
                class="report-summary-card min-w-[120px] flex-shrink-0 cursor-pointer"
                data-filter-method="Cheque">
                <p class="text-xs font-medium text-gray-500 mb-1">Cheque</p>
                <p class="text-sm font-bold text-orange-600" id="ugrai-cheque-received">₹0.00</p>
                <p class="text-xs text-gray-600" id="ugrai-cheque-count">(0)</p>
            </div>

            <!-- NEFT Card -->
            <div id="ugrai-neft-amount-card"
                class="report-summary-card min-w-[120px] flex-shrink-0 cursor-pointer"
                data-filter-method="NEFT">
                <p class="text-xs font-medium text-gray-500 mb-1">NEFT</p>
                <p class="text-sm font-bold text-blue-600" id="ugrai-neft-received">₹0.00</p>
                <p class="text-xs text-gray-600" id="ugrai-neft-count">(0)</p>
            </div>
        `;

        // Add filter bar section
        const filterBarSection = document.createElement('div');
        filterBarSection.className = 'p-4 bg-gray-50 rounded-lg border border-gray-200 lg:w-[400px] flex-shrink-0';
        filterBarSection.innerHTML = `
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <!-- Payment Type Filter -->
                <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Payment Type</label>
                    <select id="ugrai-mgmt-filter-payment" class="compact-input w-full bg-white rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
                        <option value="">All</option>
                        <option value="Cash">Cash</option>
                        <option value="UPI">UPI</option>
                        <option value="Cheque">Cheque</option>
                        <option value="NEFT">NEFT</option>
                    </select>
                </div>
                
                <!-- Person Name Filter (Searchable) -->
                <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Person Name</label>
                    <input type="text" id="ugrai-mgmt-filter-person" placeholder="Search person..." 
                        class="compact-input w-full bg-white rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
                </div>
                
                <!-- Retailer Name Filter (Searchable) -->
                <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Retailer Name</label>
                    <input type="text" id="ugrai-mgmt-filter-retailer" placeholder="Search retailer..." 
                        class="compact-input w-full bg-white rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
                </div>
                
                <!-- Sector Filter -->
                <div>
                    <label class="block text-xs font-medium text-gray-700 mb-1">Sector</label>
                    <select id="ugrai-mgmt-filter-sector" class="compact-input w-full bg-white rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
                        <option value="">All</option>
                    </select>
                </div>
            </div>
            <div class="mt-3 flex justify-end">
                <button id="ugrai-mgmt-clear-filters" class="compact-btn btn-white hover:bg-gray-200 transition-colors duration-300 text-xs">
                    Clear Filters
                </button>
            </div>
        `;

        // Append cards and filters to the combined section
        cardsAndFiltersSection.appendChild(summaryCardsSection);
        cardsAndFiltersSection.appendChild(filterBarSection);
        managementTab.appendChild(cardsAndFiltersSection);

        // Add approval table section
        const approvalTableSection = document.createElement('div');
        approvalTableSection.id = 'ugrai-approval-table-section';
        approvalTableSection.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                <h4 class="text-md font-semibold">Ugrai Bills for Approval</h4>
                <div class="flex gap-2">
                    <button id="approve-ugrai-selected-btn"
                        class="compact-btn btn-red hover:bg-red-700 transition-colors duration-300">Approve Selected</button>
                </div>
            </div>
            <div class="table-container">
                <table class="w-full text-sm">
                    <thead class="bg-black text-white uppercase">
                        <tr>
                            <th>
                                <input type="checkbox" id="ugrai-approval-select-all" class="accent-red-600">
                                Select
                            </th>
                            <th class="sortable cursor-pointer hover:bg-gray-700 transition-colors" data-column="billNumber">
                                <span class="flex items-center justify-center gap-1">
                                    Bill Number
                                    <span class="sort-indicator">⇅</span>
                                </span>
                            </th>
                            <th class="sortable cursor-pointer hover:bg-gray-700 transition-colors" data-column="billDate">
                                <span class="flex items-center justify-center gap-1">
                                    Bill Date
                                    <span class="sort-indicator">⇅</span>
                                </span>
                            </th>
                            <th class="sortable cursor-pointer hover:bg-gray-700 transition-colors" data-column="retailerName">
                                <span class="flex items-center justify-center gap-1">
                                    Retailer Name
                                    <span class="sort-indicator">⇅</span>
                                </span>
                            </th>
                            <th class="sortable cursor-pointer hover:bg-gray-700 transition-colors" data-column="sector">
                                <span class="flex items-center justify-center gap-1">
                                    Sector
                                    <span class="sort-indicator">⇅</span>
                                </span>
                            </th>
                            <th class="sortable cursor-pointer hover:bg-gray-700 transition-colors" data-column="assignedTo">
                                <span class="flex items-center justify-center gap-1">
                                    Assigned To
                                    <span class="sort-indicator">⇅</span>
                                </span>
                            </th>
                            <th class="sortable cursor-pointer hover:bg-gray-700 transition-colors" data-column="netAmount">
                                <span class="flex items-center justify-center gap-1">
                                    Net Amount
                                    <span class="sort-indicator">⇅</span>
                                </span>
                            </th>
                            <th class="sortable cursor-pointer hover:bg-gray-700 transition-colors" data-column="receivedAmount">
                                <span class="flex items-center justify-center gap-1">
                                    Received Amount
                                    <span class="sort-indicator">⇅</span>
                                </span>
                            </th>
                            <th class="sortable cursor-pointer hover:bg-gray-700 transition-colors" data-column="paymentMethod">
                                <span class="flex items-center justify-center gap-1">
                                    Payment Method
                                    <span class="sort-indicator">⇅</span>
                                </span>
                            </th>
                            <th>Photo</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="ugrai-for-approval-table">
                        <!-- Sample data for demo, will be populated by JS -->
                        <tr class="table-row">
                            <td data-label="Select">
                                <input type="checkbox" class="ugrai-approval-checkbox rounded accent-red-600"
                                    data-bill-id="sample-1" data-bill-number="UG-1001">
                            </td>
                            <td data-label="Bill Number">UG-1001</td>
                            <td data-label="Bill Date">2023-10-15</td>
                            <td data-label="Retailer Name">Sample Retailer</td>
                            <td data-label="Sector">Retail</td>
                            <td data-label="Assigned To">Sample Person</td>
                            <td data-label="Net Amount">₹2,500.00</td>
                            <td data-label="Received Amount">₹2,500.00</td>
                            <td data-label="Payment Method">Cash</td>
                            <td data-label="Actions">
                                <div class="flex gap-1 flex-wrap">
                                    <button class="edit-ugrai-btn px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors duration-300 text-xs"
                                            data-bill-id="sample-1">Edit</button>
                                    <button class="approve-ugrai-btn px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors duration-300 text-xs"
                                            data-bill-id="sample-1">Approve</button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
        managementTab.appendChild(approvalTableSection);
    }

    // Update tables with any existing data
    if (appState.data.ugraiData && appState.data.ugraiData.length > 0) {
        renderUgraiTable(appState.data.ugraiData);
    }

    renderSectorTotalsTable().catch(err => console.error('Error rendering sector totals:', err));
    renderAssignedUgraiBillsTableSync(); // Use sync version for dashboard init

    console.log("All Ugrai tabs populated successfully");
    ensureUgraiFiltersWork();
}

// Function to create the Ugrai Base File content
function createUgraiBaseFileContent() {
    const container = document.createElement('div');

    // UPDATED: Compact dropdown with filters in same row
    const dropdownRow = document.createElement('div');
    dropdownRow.className = 'flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-4';

    // Left side - Dropdown (shortened)
    const dropdownContainer = document.createElement('div');
    dropdownContainer.className = 'flex-none w-auto lg:w-64'; // Fixed width instead of flex-1

    const dropdown = document.createElement('select');
    dropdown.id = 'ugrai-data-type';
    dropdown.className = 'compact-input w-full bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-red-600';
    dropdown.innerHTML = `
        <option value="ugrai-data">Ugrai Data</option>
        <option value="ugrai-from-supplies">Ugrai from Supplies</option>
    `;

    dropdownContainer.appendChild(dropdown);

    // Right side - Filters
    const filtersContainer = document.createElement('div');
    filtersContainer.className = 'flex flex-col sm:flex-row gap-3 lg:max-w-md';
    filtersContainer.innerHTML = `
        <input type="text" id="ugrai-base-retailer-filter" placeholder="Filter by Retailer Name..."
            class="compact-input flex-1 bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
        <input type="text" id="ugrai-base-bill-filter" placeholder="Filter by Bill Number..."
            class="compact-input flex-1 bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-red-600">
    `;

    dropdownRow.appendChild(dropdownContainer);
    dropdownRow.appendChild(filtersContainer);
    container.appendChild(dropdownRow);

    // Create Ugrai Data section (initially visible)
    const ugraiDataSection = document.createElement('div');
    ugraiDataSection.id = 'ugrai-data-section';
    ugraiDataSection.className = 'mb-4';

    // Action Buttons for Ugrai Data
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex flex-wrap gap-2';
    buttonContainer.innerHTML = `
        <button id="download-ugrai-btn" class="compact-btn btn-red transition-colors duration-300">Download</button>
        <input type="file" id="ugrai-base-file-upload" class="hidden" accept=".xlsx, .xls">
        <label for="ugrai-base-file-upload" class="compact-btn btn-black transition-colors duration-300 cursor-pointer">Upload</label>
        <button id="ugrai-file-view-btn" class="compact-btn btn-white transition-colors duration-300">View</button>
    `;

    ugraiDataSection.appendChild(buttonContainer);

    // Table structure for Ugrai data
    const tableContainer = document.createElement('div');
    tableContainer.id = 'ugrai-data-table-container';
    tableContainer.className = 'hidden mt-4';
    tableContainer.innerHTML = `
        <div class="table-container">
            <table class="w-full text-sm">
                <thead class="text-xs uppercase">
                    <tr>
                        <th scope="col">Bill Number</th>
                        <th scope="col">Bill Date</th>
                        <th scope="col">Retailer Name</th>
                        <th scope="col">Sector</th>
                        <th scope="col">Net Amount</th>
                    </tr>
                </thead>
                <tbody id="ugrai-table">
                    <!-- Ugrai data will be populated here -->
                </tbody>
            </table>
        </div>
    `;

    ugraiDataSection.appendChild(tableContainer);
    container.appendChild(ugraiDataSection);

    // Create Ugrai from Supplies section (initially hidden)
    const ugraiFromSuppliesSection = document.createElement('div');
    ugraiFromSuppliesSection.id = 'ugrai-from-supplies-section';
    ugraiFromSuppliesSection.className = 'hidden';

    // Combined table for credit bills and paid bills with discrepancies
    const supplierBillsTable = document.createElement('div');
    supplierBillsTable.innerHTML = `
        <div class="mb-4">
            <h4 class="text-md font-semibold mb-2">Bills Available for Ugrai</h4>
            <p class="text-sm text-gray-600 mb-3">Credit bills and paid bills where received amount differs from net amount</p>
            <div class="table-container">
                <table class="w-full text-sm">
                    <thead class="text-xs uppercase">
                        <tr>
                            <th scope="col">Bill Number</th>
                            <th scope="col">Bill Date</th>
                            <th scope="col">Retailer Name</th>
                            <th scope="col">Sector</th>
                            <th scope="col">Net Amount</th>
                            <th scope="col">Received Amount</th>
                            <th scope="col">Type</th>
                            <th scope="col">Due Amount</th>
                        </tr>
                    </thead>
                    <tbody id="credit-bills-table">
                        <!-- Bills will be populated here -->
                    </tbody>
                </table>
            </div>
        </div>
    `;

    ugraiFromSuppliesSection.appendChild(supplierBillsTable);
    container.appendChild(ugraiFromSuppliesSection);

    return container;
}

// Function to create the Total Ugrai content (New separate tab)
function createTotalUgraiContent() {
    const container = document.createElement('div');
    container.id = 'total-ugrai-section';
    container.className = 'mb-4';

    container.innerHTML = `
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-4">
            <div>
                <h4 class="text-md font-semibold mb-2">All Pending Ugrai Bills</h4>
                <p class="text-sm text-gray-600">Combined view of Ugrai Data and Ugrai from Supplies</p>
            </div>
            <button id="print-total-ugrai-btn" class="compact-btn btn-red transition-colors duration-300">
                <svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"></path>
                </svg>
                Print by Sector
            </button>
        </div>
        <!-- Filters -->
        <div class="flex flex-col sm:flex-row gap-3 mb-4 lg:max-w-2xl">
            <input type="text" id="ugrai-retailer-filter" placeholder="Filter by Retailer Name..."
                class="compact-input flex-1 bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-green-600">
            <input type="text" id="ugrai-bill-filter" placeholder="Filter by Bill Number..."
                class="compact-input flex-1 bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-green-600">
            <input type="text" id="ugrai-sector-filter" placeholder="Filter by Sector..."
                class="compact-input flex-1 bg-gray-100 rounded-lg border border-gray-300 focus:outline-none focus:border-green-600">
        </div>
        <div class="table-container">
            <table class="w-full text-sm">
                <thead class="text-xs uppercase">
                    <tr>
                        <th scope="col" class="sortable cursor-pointer hover:bg-gray-200 transition-colors" data-column="billNumber">
                            <span class="flex items-center justify-center gap-1">
                                Bill Number
                                <span class="sort-indicator">⇅</span>
                            </span>
                        </th>
                        <th scope="col" class="sortable cursor-pointer hover:bg-gray-200 transition-colors" data-column="billDate">
                            <span class="flex items-center justify-center gap-1">
                                Bill Date
                                <span class="sort-indicator">⇅</span>
                            </span>
                        </th>
                        <th scope="col" class="sortable cursor-pointer hover:bg-gray-200 transition-colors" data-column="retailerName">
                            <span class="flex items-center justify-center gap-1">
                                Retailer Name
                                <span class="sort-indicator">⇅</span>
                            </span>
                        </th>
                        <th scope="col" class="sortable cursor-pointer hover:bg-gray-200 transition-colors" data-column="sector">
                            <span class="flex items-center justify-center gap-1">
                                Sector
                                <span class="sort-indicator">⇅</span>
                            </span>
                        </th>
                        <th scope="col" class="sortable cursor-pointer hover:bg-gray-200 transition-colors" data-column="dueAmount">
                            <span class="flex items-center justify-center gap-1">
                                Due Amount
                                <span class="sort-indicator">⇅</span>
                            </span>
                        </th>
                    </tr>
                </thead>
                <tbody id="total-ugrai-table">
                    <!-- All pending ugrai bills will be populated here -->
                </tbody>
            </table>
        </div>
    `;

    // Attach filter event listeners after the content is created
    setTimeout(() => {
        const retailerFilter = document.getElementById('ugrai-retailer-filter');
        const billFilter = document.getElementById('ugrai-bill-filter');
        const sectorFilter = document.getElementById('ugrai-sector-filter');

        if (retailerFilter && billFilter && sectorFilter) {
            console.log('✅ Attaching direct event listeners to Total Ugrai filters');

            retailerFilter.addEventListener('input', () => {
                console.log('Retailer filter changed:', retailerFilter.value);
                applyTotalUgraiFilters();
            });

            billFilter.addEventListener('input', () => {
                console.log('Bill filter changed:', billFilter.value);
                applyTotalUgraiFilters();
            });

            sectorFilter.addEventListener('input', () => {
                console.log('Sector filter changed:', sectorFilter.value);
                applyTotalUgraiFilters();
            });
        } else {
            console.log('⚠️ Could not find filter inputs to attach listeners');
        }
    }, 100);

    // Note: Data will be loaded separately when tab is shown or data is refreshed
    // Don't load here as data might not be ready yet

    return container;
}


function createUgraiIssueContent() {
    const container = document.createElement('div');

    // Add loading spinner
    const loadingElement = document.createElement('div');
    loadingElement.id = 'ugrai-issue-loading';
    loadingElement.className = 'flex justify-center items-center py-8';
    loadingElement.innerHTML = '<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>';
    container.appendChild(loadingElement);

    // Add content container
    const contentElement = document.createElement('div');
    contentElement.id = 'ugrai-issue-content';
    contentElement.style.display = 'none';

    // Add sector totals table
    const sectorTotalsSection = document.createElement('div');
    sectorTotalsSection.className = 'mb-6';

    // FIXED: Header with only Clear All button (removed Manage Persons)
    const headerRow = document.createElement('div');
    headerRow.className = 'flex justify-between items-center mb-4';

    const sectionTitle = document.createElement('h4');
    sectionTitle.className = 'text-lg font-semibold';
    sectionTitle.textContent = 'Sector Totals';

    const buttonGroup = document.createElement('div');
    buttonGroup.className = 'flex gap-2';

    // REMOVED: Manage Persons button
    const clearButton = document.createElement('button');
    clearButton.id = 'clear-all-assignments-btn';
    clearButton.className = 'compact-btn btn-red transition-colors duration-300';
    clearButton.textContent = 'Clear All';

    buttonGroup.appendChild(clearButton);
    headerRow.appendChild(sectionTitle);
    headerRow.appendChild(buttonGroup);
    sectorTotalsSection.appendChild(headerRow);

    // FIXED: Sector totals table with Due Amount column
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';
    tableContainer.innerHTML = `
        <table class="w-full text-sm">
            <thead class="text-xs uppercase">
                <tr>
                    <th scope="col">Sector</th>
                    <th scope="col">Total Bills</th>
                    <th scope="col">Total Amount</th>
                    <th scope="col">Total Due Amount</th>
                    <th scope="col">Action</th>
                </tr>
            </thead>
            <tbody id="sector-totals-table">
                <!-- Sector totals will be populated here -->
            </tbody>
        </table>
    `;

    sectorTotalsSection.appendChild(tableContainer);
    contentElement.appendChild(sectorTotalsSection);
    container.appendChild(contentElement);

    return container;
}

function createUgraiInProgressContent() {
    const container = document.createElement('div');
    container.className = 'w-full';

    // Add loading spinner
    const loadingElement = document.createElement('div');
    loadingElement.id = 'ugrai-in-progress-loading';
    loadingElement.className = 'flex justify-center items-center py-8';
    loadingElement.innerHTML = '<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600"></div>';
    container.appendChild(loadingElement);

    // Add table container (initially hidden)
    const tableContainer = document.createElement('div');
    tableContainer.id = 'ugrai-progress-table-container';
    tableContainer.style.display = 'none';

    // Add a section for assigned Ugrai bills
    const assignedBillsSection = document.createElement('div');
    assignedBillsSection.className = 'mt-4';

    const assignedTitle = document.createElement('h4');
    assignedTitle.className = 'text-lg font-semibold mb-4';
    assignedTitle.textContent = 'Assigned Ugrai Bills';

    assignedBillsSection.appendChild(assignedTitle);

    const assignedTableContainer = document.createElement('div');
    assignedTableContainer.className = 'table-container';
    // FIXED: Added Action column
    assignedTableContainer.innerHTML = `
        <table class="w-full text-sm">
            <thead class="text-xs uppercase">
                <tr>
                    <th scope="col">Bill Number</th>
                    <th scope="col">Bill Date</th>
                    <th scope="col">Retailer Name</th>
                    <th scope="col">Sector</th>
                    <th scope="col">Net Amount</th>
                    <th scope="col">Assigned To</th>
                    <th scope="col">Action</th>
                </tr>
            </thead>
            <tbody id="assigned-ugrai-bills-table">
                <!-- Assigned Ugrai bills will be populated here -->
            </tbody>
        </table>
    `;

    assignedBillsSection.appendChild(assignedTableContainer);
    tableContainer.appendChild(assignedBillsSection);
    container.appendChild(tableContainer);

    return container;
}

// Function to handle Ugrai file upload
async function handleUgraiFileUpload(e) {
    const file = e.target.files[0];
    if (!file) {
        console.log("No file selected");
        return;
    }

    const validExtensions = ['xlsx', 'xls'];
    const fileExtension = file.name.split('.').pop().toLowerCase();
    if (!validExtensions.includes(fileExtension)) {
        showToast('Please upload an Excel file (.xlsx or .xls)');
        return;
    }

    console.log('Ugrai file selected:', file.name);
    showToast('Processing file: ' + file.name);

    try {
        const rows = await readXlsxFile(file);
        console.log('File rows:', rows.length); // ADD THIS
        console.log('First few rows:', rows.slice(0, 3));

        if (!rows || rows.length < 2) {
            showToast('Excel file is empty or contains only headers.');
            return;
        }

        // Get headers (first row)
        const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
        console.log('File headers:', headers);

        // Find the exact column indices
        const billNumberIndex = headers.findIndex(h => h === 'bill number');
        const billDateIndex = headers.findIndex(h => h === 'bill date');
        const retailerNameIndex = headers.findIndex(h => h === 'retailer name');
        const sectorIndex = headers.findIndex(h => h === 'sector');
        const netAmountIndex = headers.findIndex(h => h === 'net amount');

        console.log('Column indices:', {
            billNumber: billNumberIndex,
            billDate: billDateIndex,
            retailerName: retailerNameIndex,
            sector: sectorIndex,
            netAmount: netAmountIndex
        });

        if (billNumberIndex === -1 || billDateIndex === -1 || retailerNameIndex === -1 ||
            sectorIndex === -1 || netAmountIndex === -1) {
            showToast(`Missing required columns. Headers found: ${headers.join(', ')}`);
            return;
        }

        const ugraiData = [];
        const missingRetailers = new Map(); // Track retailers that need to be created

        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            if (row.length === 0) continue;

            const billNumber = row[billNumberIndex];
            const billDate = row[billDateIndex];
            const retailerName = row[retailerNameIndex];
            const sectorFromFile = row[sectorIndex];
            const netAmount = row[netAmountIndex];

            console.log(`Row ${i}:`, { billNumber, billDate, retailerName, sector: sectorFromFile, netAmount });

            if (billNumber && netAmount > 0) {
                // Format date properly
                let formattedDate;
                if (billDate instanceof Date) {
                    formattedDate = billDate.toISOString().split('T')[0];
                } else if (typeof billDate === 'string') {
                    formattedDate = billDate;
                } else {
                    formattedDate = new Date().toISOString().split('T')[0];
                }

                // Check if retailer exists in GLOBAL list
                const retailer = appState.data.retailers.find(r =>
                    String(r.name).toLowerCase().trim() === String(retailerName || '').toLowerCase().trim()
                );

                let finalSector;

                if (retailer) {
                    // Use existing retailer's sector (GLOBAL)
                    finalSector = retailer.sector;
                } else {
                    // New retailer - use sector from file or N/A
                    finalSector = String(sectorFromFile || 'N/A');

                    if (retailerName) {
                        // Mark for creation
                        if (!missingRetailers.has(String(retailerName).toLowerCase().trim())) {
                            missingRetailers.set(String(retailerName).toLowerCase().trim(), {
                                name: String(retailerName),
                                sector: finalSector
                            });
                        }
                    }
                }

                ugraiData.push({
                    id: `UG-${billNumber}`,
                    billNumber: String(billNumber),
                    billDate: formattedDate,
                    retailerName: String(retailerName || ''),
                    sector: finalSector,
                    netAmount: parseFloat(netAmount) || 0,
                    status: 'Pending'
                });
            }
        }

        console.log('Processed Ugrai data:', ugraiData);

        if (ugraiData.length === 0) {
            showToast('No valid Ugrai data found in the Excel file.');
            return;
        }

        // Auto-create missing retailers before processing bills
        if (missingRetailers.size > 0) {
            console.log(`📝 Auto-creating ${missingRetailers.size} missing retailers from UGRAI file...`);
            const retailersToCreate = Array.from(missingRetailers.values());

            try {
                await appState.addRetailers(retailersToCreate);
                showToast(`✅ Auto-created ${missingRetailers.size} new retailer(s) from UGRAI file`, 'info', 5000);
            } catch (error) {
                console.error('Error auto-creating retailers:', error);
                showToast('⚠️ Some retailers could not be created automatically', 'warning');
            }
        }

        // Save data to database and update UI
        console.log('Saving UGRAI data to database...');
        await appState.addUgraiData(ugraiData);

        // Display data in table
        const tableContainer = document.getElementById('ugrai-data-table-container');
        if (tableContainer) {
            console.log('Showing ugrai-data-table-container');
            tableContainer.classList.remove('hidden');
        } else {
            console.log('ugrai-data-table-container not found');
        }

        // Clear input
        e.target.value = '';

        console.log('Data saved to appState:', appState.data.ugraiData.length, 'items');

    } catch (error) {
        console.error("Error processing file:", error);
        showToast('Error: ' + error.message);
    }
}

// Handle bulk import of UGRAI completed bills from Excel
async function handleUgraiBulkImport(e) {
    const file = e.target.files[0];
    if (!file) {
        console.log("No file selected");
        return;
    }

    const validExtensions = ['xlsx', 'xls'];
    const fileExtension = file.name.split('.').pop().toLowerCase();
    if (!validExtensions.includes(fileExtension)) {
        showToast('Please upload an Excel file (.xlsx or .xls)', 'error');
        return;
    }

    console.log('📤 Bulk import file selected:', file.name);
    showToast('Processing file: ' + file.name, 'info');

    try {
        // Read Excel file
        const rows = await readXlsxFile(file);
        console.log('📊 File rows:', rows.length);

        if (!rows || rows.length < 2) {
            showToast('Excel file is empty or contains only headers.', 'error');
            return;
        }

        // Parse data using same logic as transformer
        const bills = parseUgraiCompletedExcel(rows);

        if (bills.length === 0) {
            showToast('No valid bills found in Excel file', 'error');
            return;
        }

        console.log(`📦 Parsed ${bills.length} bills from Excel`);
        showToast(`Importing ${bills.length} bills...`, 'info');

        // Progress tracking
        let progressToast = null;
        const updateProgress = (progress) => {
            const percent = Math.round((progress.current / progress.total) * 100);
            const message = `📦 Importing... Batch ${progress.batch}/${progress.totalBatches} (${percent}%)`;

            if (progressToast) {
                // Update existing toast
                const toastElement = document.querySelector('.toast:last-child .toast-message');
                if (toastElement) {
                    toastElement.textContent = message;
                }
            } else {
                showToast(message, 'info');
                progressToast = true;
            }
        };

        // Call bulk import with duplicate/payment history handling and progress callback
        const results = await appState.supabaseService.bulkImportCompletedUgrai(bills, updateProgress);

        // Show results
        const message = `
            ✅ Import Complete!
            • Imported: ${results.imported} new bills
            • Skipped: ${results.skipped} existing bills
            • Payment history entries: ${results.historyCreated}
            ${results.errors.length > 0 ? `\n⚠️ Failed: ${results.errors.length} bills (see console for details)` : ''}
        `;

        showToast(message, results.errors.length > 0 ? 'warning' : 'success');

        if (results.errors.length > 0) {
            console.error('❌ Import errors:', results.errors);
            console.log('📋 Failed bill numbers:', results.errors.map(e => e.billNumber));
        }

        // Refresh the management table
        await appState.loadCompletedUgrai();
        renderDashboard();

        // Reset file input
        e.target.value = '';

    } catch (error) {
        console.error('❌ Error in bulk import:', error);
        showToast('Error importing file: ' + error.message, 'error');
    }
}

// Parse UGRAI completed Excel file (same format as transformer)
function parseUgraiCompletedExcel(rows) {
    const bills = [];

    // Expected columns from Google Sheets export
    const headers = rows[0];
    console.log('Excel headers:', headers);

    // Convert first row to header map for column name access
    const headerMap = {};
    headers.forEach((header, index) => {
        headerMap[header] = index;
    });

    console.log('Header map:', headerMap);

    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];

        // Helper to get value by column name
        const getCol = (name) => row[headerMap[name]];

        // Skip empty rows
        if (!getCol('Bill Number') || getCol('Bill Number').toString().trim() === '') continue;

        try {
            // Format date helper (handles DD/MM/YYYY and Excel serial numbers)
            const formatDate = (dateStr) => {
                if (!dateStr) return '';

                if (typeof dateStr === 'number') {
                    const excelEpoch = new Date(1899, 11, 30);
                    const msPerDay = 24 * 60 * 60 * 1000;
                    const date = new Date(excelEpoch.getTime() + dateStr * msPerDay);
                    if (!isNaN(date.getTime())) {
                        return date.toISOString().split('T')[0];
                    }
                }

                if (typeof dateStr === 'string' && dateStr.match(/^\d{2}\/\d{2}\/\d{4}/)) {
                    const parts = dateStr.split(/[\s\/]/);
                    const datePart = parts[0];
                    const [day, month, year] = datePart.split('/');
                    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                }

                const date = new Date(dateStr);
                if (isNaN(date.getTime())) return '';
                return date.toISOString().split('T')[0];
            };

            // Detect payment method and amounts using COLUMN NAMES
            const cashAmount = parseFloat(getCol('Cash Received') || 0);
            const chequeAmount = parseFloat(getCol('Cheque Amount') || 0);
            const upiAmount = parseFloat(getCol('UPI Amount Received') || 0);
            const neftAmount = parseFloat(getCol('NEFT Amount') || 0);

            let paymentMethod = 'Cash';
            let receivedAmount = 0;
            let receiptNumber = '';
            let photoUrl = '';
            let chequeDate = '';

            // Determine payment method (priority: Cash > Cheque > UPI > NEFT)
            if (cashAmount > 0) {
                paymentMethod = 'Cash';
                receivedAmount = cashAmount;
                receiptNumber = getCol('Cash Receipt Number') || '';
                photoUrl = getCol('Cash Receipt Photo') || '';
            } else if (chequeAmount > 0) {
                paymentMethod = 'Cheque';
                receivedAmount = chequeAmount;
                receiptNumber = getCol('Cheque Number') || '';
                chequeDate = formatDate(getCol('Cheque Date'));
                photoUrl = getCol('Cheque Photo') || '';
            } else if (upiAmount > 0) {
                paymentMethod = 'UPI';
                receivedAmount = upiAmount;
                receiptNumber = ''; // No receipt number for UPI
                photoUrl = getCol('UPI Payment Photo/screenshot') || '';
            } else if (neftAmount > 0) {
                paymentMethod = 'NEFT';
                receivedAmount = neftAmount;
                receiptNumber = '';
                photoUrl = '';
            } else {
                // Fallback to Payment Method column if no amounts detected
                paymentMethod = getCol('Payment Method') || 'Cash';
                receivedAmount = parseFloat(getCol('Payment received') || 0);
            }

            const bill = {
                billNumber: getCol('Bill Number').toString().trim(),
                billDate: formatDate(getCol('Bill Date')) || '1970-01-01',
                retailerName: getCol('Retailer Name') || '',
                sector: 'Unknown',
                netAmount: parseFloat(getCol('Net Amount') || 0),
                paymentMethod: paymentMethod,
                receiptNumber: receiptNumber,
                receivedAmount: receivedAmount,
                chequeDate: chequeDate || null,
                photoUploaded: !!photoUrl,
                photoUrl: photoUrl,
                dateCompleted: formatDate(getCol('Timestamp')) ? formatDate(getCol('Timestamp')).split('T')[0] : '1970-01-01',
                completedBy: getCol('Name') || '',
                assignedTo: getCol('Name') || ''
            };

            bills.push(bill);

        } catch (error) {
            console.error(`Error parsing row ${i}:`, error, row);
        }
    }

    console.log(`✅ Parsed ${bills.length} bills from Excel`);
    return bills;
}

// Function to render Ugrai data in the table
function renderUgraiTable(ugraiData) {
    console.log("Rendering Ugrai table with data:", ugraiData);

    const tableContainer = document.getElementById('ugrai-data-table-container');
    const ugraiTable = document.getElementById('ugrai-table');

    if (!tableContainer || !ugraiTable) {
        console.error("Table container or table not found");
        return;
    }

    if (!ugraiData || ugraiData.length === 0) {
        console.log("No Ugrai data available");
        ugraiTable.innerHTML = `<tr><td colspan="5" class="text-center py-4">No Ugrai data available</td></tr>`;
        return;
    }

    // ADDED: Apply filters
    let filteredData = ugraiData;

    const retailerFilter = document.getElementById('ugrai-base-retailer-filter');
    const billFilter = document.getElementById('ugrai-base-bill-filter');

    if (retailerFilter && retailerFilter.value.trim()) {
        const retailerSearchTerm = retailerFilter.value.toLowerCase().trim();
        filteredData = filteredData.filter(item =>
            (item.retailerName || '').toLowerCase().includes(retailerSearchTerm)
        );
    }

    if (billFilter && billFilter.value.trim()) {
        const billSearchTerm = billFilter.value.toLowerCase().trim();
        filteredData = filteredData.filter(item =>
            (item.billNumber || '').toLowerCase().includes(billSearchTerm)
        );
    }

    // Create table HTML with filtered data
    let tableHTML = '';
    for (const item of filteredData) {
        tableHTML += `
            <tr class="table-row">
                <td data-label="Bill Number">${item.billNumber || 'N/A'}</td>
                <td data-label="Bill Date">${item.billDate || 'N/A'}</td>
                <td data-label="Retailer Name">${item.retailerName || 'N/A'}</td>
                <td data-label="Sector">${item.sector || 'N/A'}</td>
                <td data-label="Net Amount">₹${parseFloat(item.netAmount || 0).toFixed(2)}</td>
            </tr>
        `;
    }

    ugraiTable.innerHTML = tableHTML;
    console.log("Ugrai table rendered with", filteredData.length, "filtered rows");
}


/**
 * Load and process Total UGRAI data once - shared by all UGRAI sections
 * This is the single source of truth for UGRAI Issue and UGRAI In Progress
 */
async function loadProcessedTotalUgrai() {
    console.log("📊 Loading Processed Total UGRAI (SQL-based shared data source)...");
    const startTime = performance.now();

    try {
        // Fetch all pending bills using SQL function
        const sqlResults = await appState.supabaseService.getPendingBillsDetailed();
        console.log(`  📦 Fetched ${sqlResults.length} bills from SQL function`);

        // Map SQL results to match expected format for Total UGRAI display
        const processedBills = sqlResults.map(bill => ({
            // CRITICAL: Preserve original database UUID for deletion to work
            id: bill.id,
            billNumber: bill.bill_number,
            bill_number: bill.bill_number,
            billDate: bill.bill_date,
            bill_date: bill.bill_date,
            retailerName: bill.retailer_name,
            retailer_name: bill.retailer_name,
            sector: bill.sector,
            netAmount: parseFloat(bill.net_amount || 0),
            net_amount: parseFloat(bill.net_amount || 0),
            receivedAmount: parseFloat(bill.total_received || 0),
            received_amount: parseFloat(bill.total_received || 0),
            dueAmount: parseFloat(bill.due_amount || 0),
            due_amount: parseFloat(bill.due_amount || 0),
            assignedTo: bill.assigned_to,
            assigned_to: bill.assigned_to,
            currentStage: bill.current_stage,
            current_stage: bill.current_stage,
            sourceTable: bill.source_table, // 'ugrai_data' or 'ugrai_entries'
            // Additional fields for compatibility
            bill_received_amount: parseFloat(bill.bill_received_amount || 0),
            payment_history_received: parseFloat(bill.payment_history_received || 0)
        }));

        const loadTime = (performance.now() - startTime).toFixed(2);
        console.log(`  ✅ Processed ${processedBills.length} bills with SQL in ${loadTime}ms`);

        // Store in appState for reuse
        appState.data.processedTotalUgrai = processedBills;

        return processedBills;

    } catch (error) {
        console.error('❌ Error loading processed total UGRAI:', error);
        // Fallback to empty array if SQL fails
        appState.data.processedTotalUgrai = [];
        return [];
    }
}

// Coordinated render to prevent duplicate loading states
let isRenderingUgraiIssue = false;
async function renderUgraiIssueCoordinated() {
    if (isRenderingUgraiIssue) {
        console.log('⏭️ Skipping UGRAI Issue render - already in progress');
        return;
    }

    isRenderingUgraiIssue = true;
    console.log('🎯 Starting coordinated UGRAI Issue render...');

    try {
        // Show loading state ONCE at the start
        const loadingElement = document.getElementById('ugrai-issue-loading');
        const contentElement = document.getElementById('ugrai-issue-content');
        if (loadingElement) loadingElement.style.display = 'flex';
        if (contentElement) contentElement.style.display = 'none';

        // Load assignments once
        if (appState.supabaseService) {
            console.log('📥 Loading fresh assignments...');
            const freshAssignments = await appState.supabaseService.getUgraiAssignments();
            appState.data.ugraiAssignments = freshAssignments || {};
            console.log('✅ Assignments loaded:', Object.keys(appState.data.ugraiAssignments).length, 'sectors');
        }

        // Load processed bills once
        console.log('📥 Loading processed UGRAI data...');
        await loadProcessedTotalUgrai();
        console.log('✅ Data loaded:', appState.data.processedTotalUgrai?.length || 0, 'bills');

        // Render both tables (they'll use cached data)
        console.log('🎨 Rendering Sector Totals...');
        await renderSectorTotalsTable(true); // true = skip loading state management

        console.log('🎨 Rendering Assigned Bills...');
        await renderAssignedUgraiBillsTable(true); // true = skip loading state management

        // Hide loading state ONCE at the end
        if (loadingElement) loadingElement.style.display = 'none';
        if (contentElement) contentElement.style.display = 'block';

        console.log('✅ UGRAI Issue render complete');
    } catch (error) {
        console.error('❌ Error in coordinated UGRAI Issue render:', error);
        // Hide loading on error
        const loadingElement = document.getElementById('ugrai-issue-loading');
        const contentElement = document.getElementById('ugrai-issue-content');
        if (loadingElement) loadingElement.style.display = 'none';
        if (contentElement) contentElement.style.display = 'block';
    } finally {
        isRenderingUgraiIssue = false;
    }
}

async function calculateSectorTotals() {
    // Use shared processed data instead of fetching separately
    let processedBills = appState.data.processedTotalUgrai;

    // If not loaded yet, load it now
    if (!processedBills) {
        console.log("⚠️ Processed Total UGRAI not loaded, loading now...");
        processedBills = await loadProcessedTotalUgrai();
    }

    // Data is already filtered and has due amounts calculated from loadProcessedTotalUgrai()
    console.log(`🔍 UGRAI Issue - Using ${processedBills.length} pre-processed bills`);
    const billsWithDueAmounts = processedBills;

    // Group by sector
    const sectorTotals = {};

    billsWithDueAmounts.forEach(item => {
        const sector = item.sector || 'Unassigned';
        const netAmount = parseFloat(item.netAmount || item.amount || 0);
        const dueAmount = parseFloat(item.dueAmount || 0);

        if (!sectorTotals[sector]) {
            sectorTotals[sector] = {
                billCount: 0,
                totalAmount: 0,
                totalDueAmount: 0
            };
        }

        sectorTotals[sector].billCount += 1;
        sectorTotals[sector].totalAmount += netAmount;
        sectorTotals[sector].totalDueAmount += dueAmount;
    });

    return sectorTotals;
}


async function renderSectorTotalsTable(skipLoadingState = false) {
    console.log("Rendering sector totals table...", skipLoadingState ? '(coordinated)' : '(standalone)');

    // Only manage loading state if not being coordinated
    const loadingElement = document.getElementById('ugrai-issue-loading');
    const contentElement = document.getElementById('ugrai-issue-content');
    if (!skipLoadingState) {
        if (loadingElement) loadingElement.style.display = 'flex';
        if (contentElement) contentElement.style.display = 'none';
    }

    const sectorTotalsTable = document.getElementById('sector-totals-table');
    if (!sectorTotalsTable) return;

    // Only refresh assignments if not being coordinated (coordinated function already loaded them)
    if (!skipLoadingState && appState.supabaseService) {
        console.log("🔄 Force refreshing assignments from ugrai_assignments table...");
        const freshAssignments = await appState.supabaseService.getUgraiAssignments();
        appState.data.ugraiAssignments = freshAssignments || {};
        console.log("✅ Fresh assignments loaded:", Object.keys(appState.data.ugraiAssignments).length, "sectors");
    }

    const sectorTotals = await calculateSectorTotals();
    if (Object.keys(sectorTotals).length === 0) {
        sectorTotalsTable.innerHTML = `<tr><td colspan="5" class="text-center py-4">No Ugrai data available</td></tr>`;
        return;
    }

    // Get UGRAI assignees from database
    const ugraiAssignees = appState.data.ugraiAssignees || [];
    console.log('🔍 renderSectorTotalsTable - ugraiAssignees:', ugraiAssignees);
    const personOptions = ugraiAssignees.length > 0
        ? ugraiAssignees.map(assignee =>
            `<option value="${assignee.full_name}">${assignee.full_name}</option>`
        ).join('')
        : (appState.data.persons || []).map(name =>
            `<option value="${name}">${name}</option>`
        ).join('');
    console.log('🔍 renderSectorTotalsTable - personOptions:', personOptions);

    // ADDED: Sort sectors in ascending order
    const sortedSectors = Object.entries(sectorTotals).sort((a, b) => {
        return a[0].localeCompare(b[0]); // Sort by sector name (a[0] and b[0] are the keys)
    });

    // FIXED: Generate table rows with Due Amount column
    const rows = sortedSectors.map(([sector, data]) => { // Changed from Object.entries to sortedSectors
        const assignedTo = appState.data.ugraiAssignments && appState.data.ugraiAssignments[sector] || '';

        return `
            <tr class="table-row">
                <td data-label="Sector">${sector}</td>
                <td data-label="Total Bills">${data.billCount}</td>
                <td data-label="Total Amount">₹${data.totalAmount.toFixed(2)}</td>
                <td data-label="Total Due Amount">₹${data.totalDueAmount.toFixed(2)}</td>
                <td data-label="Action">
                    <select class="sector-assignment bg-gray-100 rounded-lg p-1.5 border border-gray-300 focus:outline-none focus:border-red-600"
                            data-sector="${sector}">
                        <option value="">Select Person</option>
                        ${personOptions}
                    </select>
                </td>
            </tr>
        `;
    });

    sectorTotalsTable.innerHTML = rows.join('');

    // Set selected values based on existing assignments
    if (appState.data.ugraiAssignments) {
        document.querySelectorAll('.sector-assignment').forEach(select => {
            const sector = select.dataset.sector;
            if (appState.data.ugraiAssignments[sector]) {
                select.value = appState.data.ugraiAssignments[sector];
            }
        });
    }

    // Only hide loading state if we showed it (not coordinated)
    if (!skipLoadingState) {
        if (loadingElement) loadingElement.style.display = 'none';
        if (contentElement) contentElement.style.display = 'block';
    }
}

// Persist assignment changes when user selects a person for a sector
document.addEventListener('change', function (e) {
    if (e.target && e.target.classList && e.target.classList.contains('sector-assignment')) {
        try {
            const sector = e.target.dataset.sector;
            const value = e.target.value;

            // Build new assignments object
            const current = appState.data.ugraiAssignments || {};
            const updated = { ...current, [sector]: value };

            // Save assignments via appState (which will call SupabaseService when enabled)
            (async () => {
                await appState.saveUgraiAssignments(updated);
                showToast('UGRAI assignments updated', 'success');
            })();
        } catch (err) {
            console.error('Error saving UGRAI assignment:', err);
            showToast('Error saving assignment', 'error');
        }
    }
});

async function renderAssignedUgraiBillsTable(skipLoadingState = false) {
    console.log("Rendering assigned ugrai bills table...", skipLoadingState ? '(coordinated)' : '(standalone)');
    const assignedTable = document.getElementById('assigned-ugrai-bills-table');
    if (!assignedTable) return;

    // Get all Ugrai data from all sources
    let allUgraiData = [];

    // Combine data from all sources (including ugraiInProgress)
    if (appState.data.ugraiData && appState.data.ugraiData.length > 0) {
        allUgraiData.push(...appState.data.ugraiData);
    }

    if (appState.data.ugraiEntries && appState.data.ugraiEntries.length > 0) {
        allUgraiData.push(...appState.data.ugraiEntries);
    }

    // Filter out ghost bills (already approved bills) for Supabase mode
    if (!mockMode && appState.supabaseService && allUgraiData.length > 0) {
        const originalCount = allUgraiData.length;
        const filteredData = [];

        for (const bill of allUgraiData) {
            if (bill.billNumber) {
                try {
                    const isAlreadyApproved = await appState.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);
                    if (!isAlreadyApproved) {
                        filteredData.push(bill);
                    } else {
                        console.log('👻 Filtering out ghost bill from UGRAI In Progress:', bill.billNumber, '- already approved on', isAlreadyApproved.date_approved);
                    }
                } catch (error) {
                    console.warn('⚠️ Error checking ghost bill status for', bill.billNumber, '- including in display:', error);
                    filteredData.push(bill); // Include if we can't verify (fail safe)
                }
            } else {
                filteredData.push(bill); // Include bills without bill numbers
            }
        }

        allUgraiData = filteredData;

        if (originalCount !== filteredData.length) {
            console.log(`🧹 Filtered UGRAI In Progress: ${originalCount} -> ${filteredData.length} (removed ${originalCount - filteredData.length} ghost bills)`);
        }
    }

    // FIXED: Show bill-wise data for assigned sectors only
    const ugraiAssignments = appState.data.ugraiAssignments || {};
    const assignedSectors = Object.keys(ugraiAssignments);

    const assignedBills = allUgraiData.filter(bill =>
        bill.sector && assignedSectors.includes(bill.sector)
    );

    if (assignedBills.length === 0) {
        assignedTable.innerHTML = `<tr><td colspan="7" class="text-center py-4">No assigned Ugrai bills</td></tr>`;
        return;
    }

    // FIXED: Added Action button for each bill
    const rows = assignedBills.map(bill => `
        <tr class="table-row">
            <td data-label="Bill Number">${bill.billNumber || bill.id || 'N/A'}</td>
            <td data-label="Bill Date">${bill.billDate || new Date().toISOString().split('T')[0]}</td>
            <td data-label="Retailer Name">${bill.retailerName || 'N/A'}</td>
            <td data-label="Sector">${bill.sector || 'N/A'}</td>
            <td data-label="Net Amount">₹${parseFloat(bill.netAmount || bill.amount || 0).toFixed(2)}</td>
            <td data-label="Assigned To">${ugraiAssignments[bill.sector] || 'Unassigned'}</td>
            <td data-label="Action">
    <button class="ugrai-done-btn px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors duration-300 text-xs" 
            data-bill-id="${bill.id || bill.billNumber}" 
            data-bill-number="${bill.billNumber}">
        Ugrai Done
    </button>
</td>
        </tr>
    `).join('');

    assignedTable.innerHTML = rows;
}

// Non-async wrapper function to maintain compatibility with existing calls
async function renderAssignedUgraiBillsTableSync() {
    // For immediate rendering without ghost bill checking (faster)
    console.log("🎨 Rendering assigned ugrai bills table (sync)...");

    // Show loading state
    const loadingElement = document.getElementById('ugrai-in-progress-loading');
    const tableContainer = document.getElementById('ugrai-progress-table-container');
    if (loadingElement) loadingElement.style.display = 'flex';
    if (tableContainer) tableContainer.style.display = 'none';

    const assignedTable = document.getElementById('assigned-ugrai-bills-table') || document.getElementById('ugrai-progress-table');
    if (!assignedTable) {
        console.warn('❌ Table element not found (assigned-ugrai-bills-table or ugrai-progress-table)');
        return;
    }

    // FORCE REFRESH: Load fresh assignments from ugrai_assignments table
    console.log("🔄 Force refreshing assignments from ugrai_assignments table...");
    if (appState.supabaseService) {
        const freshAssignments = await appState.supabaseService.getUgraiAssignments();
        appState.data.ugraiAssignments = freshAssignments || {};
        console.log("✅ Fresh assignments loaded:", Object.keys(appState.data.ugraiAssignments).length, "sectors");
    } else {
        console.warn("⚠️ supabaseService not available, using cached assignments");
    }

    // Note: Cleanup removed - the backend handles data consistency via SQL functions
    // We just render what's in the database

    // NEW FLOW: Use dedicated in-progress data
    let assignedBills = [];

    // Use shared processed data from Total UGRAI
    let processedBills = appState.data.processedTotalUgrai;

    // If not loaded yet, load it now
    if (!processedBills) {
        console.log("⚠️ Processed Total UGRAI not loaded for In Progress, loading now...");
        processedBills = await loadProcessedTotalUgrai();
    }

    console.log(`🚀 UGRAI In Progress - Using ${processedBills.length} pre-processed bills from Total UGRAI`);

    // Filter for bills that are assigned (have a person assigned to their sector)
    const ugraiAssignments = appState.data.ugraiAssignments || {};
    const assignedSectors = Object.keys(ugraiAssignments).filter(sector =>
        ugraiAssignments[sector] && ugraiAssignments[sector].trim() !== ''
    );

    console.log(`📍 Assigned sectors:`, assignedSectors);

    assignedBills = processedBills.filter(bill => {
        return bill.sector && assignedSectors.includes(bill.sector);
    });

    // Add assignedTo field to each bill for display
    assignedBills = assignedBills.map(bill => ({
        ...bill,
        assignedTo: ugraiAssignments[bill.sector] || ''
    }));

    console.log(`🎯 UGRAI In Progress - Showing ${assignedBills.length} assigned bills`);

    // Legacy flow fallback (if needed)
    if (false) {
        console.log('⚠️ No ugraiInProgress data, falling back to legacy flow');
        console.log('  - ugraiInProgress exists?', !!appState.data.ugraiInProgress);
        console.log('  - ugraiInProgress length:', appState.data.ugraiInProgress?.length);
        // Fallback to old logic for backward compatibility
        const allUgraiData = [];

        // Combine data from both sources
        if (appState.data.ugraiData && appState.data.ugraiData.length > 0) {
            allUgraiData.push(...appState.data.ugraiData);
        }

        if (appState.data.ugraiEntries && appState.data.ugraiEntries.length > 0) {
            allUgraiData.push(...appState.data.ugraiEntries);
        }

        // FIXED: Show bill-wise data for assigned sectors only
        const ugraiAssignments = appState.data.ugraiAssignments || {};
        // Only include sectors that have actual person assignments (not null/empty)
        const assignedSectors = Object.keys(ugraiAssignments).filter(sector =>
            ugraiAssignments[sector] && ugraiAssignments[sector].trim() !== ''
        );

        // Get unique sectors from all bills
        const allSectors = [...new Set(allUgraiData.map(bill => bill.sector || bill.Sector).filter(Boolean))];
        const unassignedSectors = allSectors.filter(sector => !assignedSectors.includes(sector));

        // Debug logging to understand the issue
        console.log('🔍 UGRAI Debug Info:', {
            totalUgraiData: allUgraiData.length,
            ugraiAssignments: ugraiAssignments,
            assignedSectors: assignedSectors,
            allSectorsInBills: allSectors,
            unassignedSectors: unassignedSectors,
            sectorsWithActualAssignments: assignedSectors.length,
            sampleBills: allUgraiData.slice(0, 3).map(b => ({ sector: b.sector, billNumber: b.billNumber }))
        });

        if (unassignedSectors.length > 0) {
            console.log(`⚠️ ${unassignedSectors.length} sectors need person assignments:`, unassignedSectors);
        }

        assignedBills = allUgraiData.filter(bill => {
            const hasMatchingSector = bill.sector && assignedSectors.includes(bill.sector);
            if (!hasMatchingSector && bill.sector) {
                console.log(`🔍 Bill ${bill.billNumber} sector "${bill.sector}" not in assigned sectors:`, assignedSectors);
            }
            return hasMatchingSector;
        });

        console.log('⚠️ Using legacy UGRAI flow: assigned sectors');
        console.log('🎯 Filtered assigned bills:', assignedBills.length, 'bills found (only bills with assigned persons)');

        if (assignedBills.length === 0 && allUgraiData.length > 0 && assignedSectors.length > 0) {
            console.log('❌ No bills matched assigned sectors. Check if sector names match exactly between bills and assignments.');
        }
    }

    // Populate person filter dropdown
    const ugraiPersonFilter = document.getElementById('ugrai-progress-person-filter');
    if (ugraiPersonFilter) {
        // Get unique persons from UGRAI assignees
        const ugraiAssignees = appState.data.ugraiAssignees || [];
        const uniquePersons = new Set();

        // Add persons from assignments
        Object.values(ugraiAssignments).forEach(person => {
            if (person && person.trim()) uniquePersons.add(person);
        });

        // Add persons from assignees list
        ugraiAssignees.forEach(assignee => {
            if (assignee.full_name) uniquePersons.add(assignee.full_name);
        });

        // Sort and populate dropdown
        const sortedPersons = Array.from(uniquePersons).sort();
        const currentValue = ugraiPersonFilter.value; // Preserve selection
        ugraiPersonFilter.innerHTML = '<option value="">All Persons</option>' +
            sortedPersons.map(person => `<option value="${person}">${person}</option>`).join('');

        // Restore previous selection if it still exists
        if (currentValue && sortedPersons.includes(currentValue)) {
            ugraiPersonFilter.value = currentValue;
        }
    }

    // Apply filters for ugrai progress
    const ugraiRetailerFilter = document.getElementById('ugrai-progress-retailer-filter');
    const ugraiBillFilter = document.getElementById('ugrai-progress-bill-filter');
    const ugraiSectorFilter = document.getElementById('ugrai-progress-sector-filter');

    if (ugraiRetailerFilter && ugraiRetailerFilter.value.trim()) {
        const retailerSearchTerm = ugraiRetailerFilter.value.toLowerCase();
        assignedBills = assignedBills.filter(bill =>
            bill.retailerName && bill.retailerName.toLowerCase().includes(retailerSearchTerm)
        );
    }

    if (ugraiBillFilter && ugraiBillFilter.value.trim()) {
        const billSearchTerm = ugraiBillFilter.value.toLowerCase();
        assignedBills = assignedBills.filter(bill =>
            bill.billNumber && bill.billNumber.toLowerCase().includes(billSearchTerm)
        );
    }

    if (ugraiSectorFilter && ugraiSectorFilter.value.trim()) {
        const sectorSearchTerm = ugraiSectorFilter.value.toLowerCase();
        assignedBills = assignedBills.filter(bill =>
            bill.sector && bill.sector.toLowerCase().includes(sectorSearchTerm)
        );
    }

    if (ugraiPersonFilter && ugraiPersonFilter.value.trim()) {
        const personSearchTerm = ugraiPersonFilter.value;
        assignedBills = assignedBills.filter(bill =>
            bill.assignedTo === personSearchTerm
        );
    }

    if (assignedBills.length === 0) {
        assignedTable.innerHTML = `<tr><td colspan="7" class="text-center py-8">
            <div class="text-gray-500">
                <svg class="mx-auto h-12 w-12 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p class="text-lg font-medium">No Bills Assigned Yet</p>
            </div>
        </td></tr>`;

        // Hide loading and show content
        if (loadingElement) loadingElement.style.display = 'none';
        if (tableContainer) tableContainer.style.display = 'block';

        return;
    }

    // Get current assignments (for backward compatibility with legacy flow)
    const assignments = appState.data.ugraiAssignments || {};
    console.log('🔍 Current assignments for In Progress:', assignments);

    // FIXED: Added Action button for each bill
    const rows = assignedBills.map(bill => {
        const dueAmount = parseFloat(bill.dueAmount || 0);
        return `
        <tr class="table-row">
            <td data-label="Bill Number">${bill.billNumber || bill.id || 'N/A'}</td>
            <td data-label="Bill Date">${bill.billDate || new Date().toISOString().split('T')[0]}</td>
            <td data-label="Retailer Name">${bill.retailerName || 'N/A'}</td>
            <td data-label="Sector">${bill.sector || 'N/A'}</td>
            <td data-label="Due Amount">₹${dueAmount.toFixed(2)}</td>
            <td data-label="Assigned To">${bill.assignedTo || assignments[bill.sector] || 'N/A'}</td>
            <td data-label="Action">
    <button class="ugrai-done-btn px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 transition-colors duration-300 text-xs" 
            data-bill-id="${bill.id || bill.billNumber}" 
            data-bill-number="${bill.billNumber}">
        Ugrai Done
    </button>
</td>
        </tr>
    `;
    }).join('');

    assignedTable.innerHTML = rows;

    // Hide loading state and show table (reuse variables from top)
    if (loadingElement) loadingElement.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';
}

// Populate sector filter dropdown for UGRAI Management
function populateUgraiManagementSectorFilter(bills) {
    const sectorFilter = document.getElementById('ugrai-mgmt-filter-sector');
    if (!sectorFilter) return;

    // Get unique sectors from bills
    const sectors = [...new Set(bills.map(bill => bill.sector).filter(s => s && s !== 'N/A'))].sort();

    // Keep the "All" option and add sectors
    const currentValue = sectorFilter.value;
    sectorFilter.innerHTML = '<option value="">All</option>' +
        sectors.map(sector => `<option value="${sector}">${sector}</option>`).join('');

    // Restore previous selection if it still exists
    if (currentValue && sectors.includes(currentValue)) {
        sectorFilter.value = currentValue;
    }
}

// Initialize UGRAI Management filters
function initializeUgraiManagementFilters(allBills) {
    // Store the original bills data for filtering (always update with fresh data)
    window.ugraiManagementData = allBills;

    // Apply filters function
    const applyFilters = () => {
        const paymentValue = document.getElementById('ugrai-mgmt-filter-payment')?.value.toLowerCase() || '';
        const personValue = document.getElementById('ugrai-mgmt-filter-person')?.value.toLowerCase() || '';
        const retailerValue = document.getElementById('ugrai-mgmt-filter-retailer')?.value.toLowerCase() || '';
        const sectorValue = document.getElementById('ugrai-mgmt-filter-sector')?.value.toLowerCase() || '';

        let filteredBills = window.ugraiManagementData;

        // Apply payment filter
        if (paymentValue) {
            filteredBills = filteredBills.filter(bill =>
                (bill.paymentMethod || '').toLowerCase() === paymentValue
            );
        }

        // Apply person name filter (searchable)
        if (personValue) {
            filteredBills = filteredBills.filter(bill => {
                const assignedTo = (bill.assignedTo || bill.assigned_to || bill.completedBy || bill.completed_by || '').toLowerCase();
                return assignedTo.includes(personValue);
            });
        }

        // Apply retailer name filter (searchable)
        if (retailerValue) {
            filteredBills = filteredBills.filter(bill =>
                (bill.retailerName || '').toLowerCase().includes(retailerValue)
            );
        }

        // Apply sector filter
        if (sectorValue) {
            filteredBills = filteredBills.filter(bill =>
                (bill.sector || '').toLowerCase() === sectorValue
            );
        }

        // Apply sorting if sort state exists
        if (window.ugraiManagementSortColumn) {
            filteredBills.sort((a, b) => {
                let aVal = a[window.ugraiManagementSortColumn];
                let bVal = b[window.ugraiManagementSortColumn];

                // Handle assignedTo special case (multiple possible field names)
                if (window.ugraiManagementSortColumn === 'assignedTo') {
                    aVal = a.assignedTo || a.assigned_to || a.completedBy || a.completed_by || '';
                    bVal = b.assignedTo || b.assigned_to || b.completedBy || b.completed_by || '';
                }

                if (aVal == null) aVal = '';
                if (bVal == null) bVal = '';

                // Numeric sorting for amount columns
                if (window.ugraiManagementSortColumn === 'netAmount' || window.ugraiManagementSortColumn === 'receivedAmount') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                    return window.ugraiManagementSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }

                // Date sorting for billDate
                if (window.ugraiManagementSortColumn === 'billDate') {
                    aVal = new Date(aVal).getTime() || 0;
                    bVal = new Date(bVal).getTime() || 0;
                    return window.ugraiManagementSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }

                // String sorting for other columns
                aVal = String(aVal).toLowerCase();
                bVal = String(bVal).toLowerCase();

                if (window.ugraiManagementSortDirection === 'asc') {
                    return aVal.localeCompare(bVal);
                } else {
                    return bVal.localeCompare(aVal);
                }
            });
        }

        // Update the table with filtered bills
        const ugraiForApprovalTable = document.getElementById('ugrai-for-approval-table');
        if (ugraiForApprovalTable) {
            if (filteredBills.length === 0) {
                ugraiForApprovalTable.innerHTML = `
                    <tr>
                        <td colspan="11" class="text-center py-4">No bills match the selected filters</td>
                    </tr>
                `;
            } else {
                ugraiForApprovalTable.innerHTML = filteredBills.map(bill => `
                    <tr class="table-row">
                        <td data-label="Select">
                            <input type="checkbox" class="ugrai-approval-checkbox rounded accent-red-600" 
                                data-bill-id="${bill.id || bill.billNumber}">
                        </td>
                        <td data-label="Bill Number">${bill.billNumber || 'N/A'}</td>
                        <td data-label="Bill Date">${bill.billDate || 'N/A'}</td>
                        <td data-label="Retailer Name">${bill.retailerName || 'N/A'}</td>
                        <td data-label="Sector">${bill.sector || 'N/A'}</td>
                        <td data-label="Assigned To">${bill.assignedTo || bill.assigned_to || bill.completedBy || bill.completed_by || 'N/A'}</td>
                        <td data-label="Net Amount">₹${parseFloat(bill.netAmount || 0).toFixed(2)}</td>
                        <td data-label="Received Amount">₹${parseFloat(bill.receivedAmount || bill.netAmount || 0).toFixed(2)}</td>
                        <td data-label="Payment Method">${bill.paymentMethod || 'N/A'}</td>
                        <td data-label="Photo" class="text-center">
                            <div class="ugrai-photo-cell" data-bill-number="${bill.billNumber}">
                                <div class="inline-flex items-center justify-center">
                                    <svg class="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                </div>
                            </div>
                        </td>
                        <td data-label="Actions">
                            <div class="flex gap-1 flex-wrap">
                                <button class="revert-ugrai-btn px-2 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors duration-300 text-xs"
                                        data-bill-id="${bill.id || bill.billNumber}">Revert</button>
                                <button class="edit-ugrai-btn px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors duration-300 text-xs"
                                        data-bill-id="${bill.id || bill.billNumber}">Edit</button>
                                <button class="approve-ugrai-btn px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors duration-300 text-xs"
                                        data-bill-id="${bill.id || bill.billNumber}">Approve</button>
                            </div>
                        </td>
                    </tr>
                `).join('');

                // Load photos asynchronously for filtered bills
                loadUgraiManagementPhotos(filteredBills);
            }
        }
    };

    // Get fresh DOM references and attach event listeners
    // Clone and replace to remove any old listeners (clean slate)
    const paymentFilterElement = document.getElementById('ugrai-mgmt-filter-payment');
    const personFilterElement = document.getElementById('ugrai-mgmt-filter-person');
    const retailerFilterElement = document.getElementById('ugrai-mgmt-filter-retailer');
    const sectorFilterElement = document.getElementById('ugrai-mgmt-filter-sector');
    const clearButtonElement = document.getElementById('ugrai-mgmt-clear-filters');

    if (paymentFilterElement) {
        const newPayment = paymentFilterElement.cloneNode(true);
        paymentFilterElement.replaceWith(newPayment);
        newPayment.addEventListener('change', applyFilters);
    }

    if (personFilterElement) {
        const newPerson = personFilterElement.cloneNode(true);
        personFilterElement.replaceWith(newPerson);
        newPerson.addEventListener('input', applyFilters);
    }

    if (retailerFilterElement) {
        const newRetailer = retailerFilterElement.cloneNode(true);
        retailerFilterElement.replaceWith(newRetailer);
        newRetailer.addEventListener('input', applyFilters);
    }

    if (sectorFilterElement) {
        const newSector = sectorFilterElement.cloneNode(true);
        sectorFilterElement.replaceWith(newSector);
        newSector.addEventListener('change', applyFilters);
    }

    if (clearButtonElement) {
        const newClearBtn = clearButtonElement.cloneNode(true);
        clearButtonElement.replaceWith(newClearBtn);
        newClearBtn.addEventListener('click', () => {
            const paymentFilter = document.getElementById('ugrai-mgmt-filter-payment');
            const personFilter = document.getElementById('ugrai-mgmt-filter-person');
            const retailerFilter = document.getElementById('ugrai-mgmt-filter-retailer');
            const sectorFilter = document.getElementById('ugrai-mgmt-filter-sector');

            if (paymentFilter) paymentFilter.value = '';
            if (personFilter) personFilter.value = '';
            if (retailerFilter) retailerFilter.value = '';
            if (sectorFilter) sectorFilter.value = '';

            applyFilters();
        });
    }
}

function ensureUgraiFiltersWork() {
    // Use delegated listeners so filters work even if inputs are created later
    document.addEventListener('input', (e) => {
        try {
            const target = e.target;
            if (!target) return;

            const id = target.id;

            // Handle Total Ugrai filters (separate tab with sector filter)
            if (id === 'ugrai-retailer-filter' || id === 'ugrai-bill-filter' || id === 'ugrai-sector-filter') {
                setTimeout(() => applyTotalUgraiFilters(), 0);
                return;
            }

            // Handle Ugrai Base File filters (tab with dropdown, no sector filter)
            if (id === 'ugrai-base-retailer-filter' || id === 'ugrai-base-bill-filter') {
                const currentSection = document.getElementById('ugrai-data-type')?.value || 'ugrai-data';
                if (currentSection === 'ugrai-data') {
                    renderUgraiTable(appState.data.ugraiData || []);
                } else {
                    loadCreditBills();
                }
                return;
            }

            // Handle Supply Progress filters
            if (id === 'supply-progress-retailer-filter' ||
                id === 'supply-progress-bill-filter' ||
                id === 'supply-progress-sector-filter') {
                renderDashboard();
                return;
            }

            // Handle Ugrai Progress filters
            if (id === 'ugrai-progress-retailer-filter' ||
                id === 'ugrai-progress-bill-filter' ||
                id === 'ugrai-progress-sector-filter' ||
                id === 'ugrai-progress-person-filter') {
                renderAssignedUgraiBillsTableSync();
                return;
            }

            // Handle Purchase Base File filter
            if (id === 'purchase-retailer-filter') {
                renderDashboard();
                return;
            }
        } catch (err) {
            console.error('Error in Ugrai input handler:', err);
        }
    });

    // Also handle Enter/keyup events for better UX
    document.addEventListener('keyup', (e) => {
        const id = e.target?.id;

        // Handle Total Ugrai filters
        if (id === 'ugrai-retailer-filter' || id === 'ugrai-bill-filter' || id === 'ugrai-sector-filter') {
            setTimeout(() => applyTotalUgraiFilters(), 0);
        }

        // Handle Ugrai Base File filters
        if (id === 'ugrai-base-retailer-filter' || id === 'ugrai-base-bill-filter') {
            const currentSection = document.getElementById('ugrai-data-type')?.value || 'ugrai-data';
            if (currentSection === 'ugrai-data') {
                renderUgraiTable(appState.data.ugraiData || []);
            } else {
                loadCreditBills();
            }
        }

        // Handle Supply Progress filters on keyup
        if (id === 'supply-progress-retailer-filter' ||
            id === 'supply-progress-bill-filter' ||
            id === 'supply-progress-sector-filter') {
            renderDashboard();
        }

        // Handle Ugrai Progress filters on keyup
        if (id === 'ugrai-progress-retailer-filter' ||
            id === 'ugrai-progress-bill-filter' ||
            id === 'ugrai-progress-sector-filter' ||
            id === 'ugrai-progress-person-filter') {
            renderAssignedUgraiBillsTableSync();
        }

        // Handle Purchase Base File filter on keyup
        if (id === 'purchase-retailer-filter') {
            renderDashboard();
        }
    });

    // Handle the section dropdown so switching updates the visible section and triggers a render
    document.addEventListener('change', (e) => {
        const target = e.target;
        if (!target) return;
        if (target.id === 'ugrai-data-type') {
            const val = target.value;
            const dataSection = document.getElementById('ugrai-data-section');
            const fromSuppliesSection = document.getElementById('ugrai-from-supplies-section');
            if (val === 'ugrai-data') {
                if (dataSection) dataSection.classList.remove('hidden');
                if (fromSuppliesSection) fromSuppliesSection.classList.add('hidden');
                // show table if it was previously hidden
                const tableContainer = document.getElementById('ugrai-data-table-container');
                if (tableContainer) tableContainer.classList.remove('hidden');
                renderUgraiTable(appState.data.ugraiData || []);
            } else {
                if (dataSection) dataSection.classList.add('hidden');
                if (fromSuppliesSection) fromSuppliesSection.classList.remove('hidden');
                loadCreditBills();
            }
        }
    });
}

// Make sure to call this after populating the tabs
ensureUgraiFiltersWork();

// Apply filters to Total UGRAI data
function applyTotalUgraiFilters() {
    console.log("🔍 Applying filters to Total UGRAI data...");

    const totalUgraiTable = document.querySelector('#total-ugrai-table');
    if (!totalUgraiTable) {
        console.log("❌ Total UGRAI table not found");
        return;
    }

    // Get filter input elements
    const retailerInput = document.getElementById('ugrai-retailer-filter');
    const billInput = document.getElementById('ugrai-bill-filter');
    const sectorInput = document.getElementById('ugrai-sector-filter');

    console.log("🔍 Filter inputs found:", {
        retailer: !!retailerInput,
        bill: !!billInput,
        sector: !!sectorInput
    });

    // Get filter values
    const retailerFilter = retailerInput?.value?.toLowerCase() || '';
    const billFilter = billInput?.value?.toLowerCase() || '';
    const sectorFilter = sectorInput?.value?.toLowerCase() || '';

    console.log("🔍 Filter values:", {
        retailerFilter,
        billFilter,
        sectorFilter,
        retailerRaw: retailerInput?.value,
        billRaw: billInput?.value,
        sectorRaw: sectorInput?.value
    });

    // Get all table rows
    const rows = totalUgraiTable.querySelectorAll('tr');
    console.log(`📊 Found ${rows.length} rows in table`);
    let visibleCount = 0;

    rows.forEach((row, index) => {
        // Get all cells directly
        const cells = row.querySelectorAll('td');

        if (cells.length < 4) {
            // Not a data row (might be header or empty)
            return;
        }

        // Assuming column order: Bill Number, Bill Date, Retailer Name, Sector, Brand, Net Amount, Due Amount, Source
        const billNumber = cells[0]?.textContent?.toLowerCase() || '';
        const retailerName = cells[2]?.textContent?.toLowerCase() || '';
        const sectorName = cells[3]?.textContent?.toLowerCase() || '';

        // Debug first row
        if (index === 0) {
            console.log('🔍 First row data:', { billNumber, retailerName, sectorName });
        }

        // Check if row matches filters
        const matchesRetailer = !retailerFilter || retailerName.includes(retailerFilter);
        const matchesBill = !billFilter || billNumber.includes(billFilter);
        const matchesSector = !sectorFilter || sectorName.includes(sectorFilter);

        if (matchesRetailer && matchesBill && matchesSector) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });

    console.log(`✅ Total UGRAI filters applied: ${visibleCount} rows visible out of ${rows.length}`);
}

// PHOTO STORAGE HELPER FUNCTIONS

/**
 * Upload photo for a bill using Supabase Storage
 * @param {File} file - The photo file
 * @param {string} billNumber - Bill number
 * @param {string} billType - 'supply', 'ugrai', 'purchase', or 'analysis'
 * @param {string} photoType - Optional photo type
 * @returns {Promise<Object>} Upload result with URL
 */
async function uploadBillPhoto(file, billNumber, billType, photoType = 'receipt') {
    try {
        console.log(`📸 Uploading ${billType} photo for bill: ${billNumber}`);

        if (!appState.supabaseService) {
            throw new Error('Supabase service not available');
        }

        // Show upload progress
        showToast('Uploading photo...', 'info');

        const result = await appState.supabaseService.uploadBillPhoto(
            file,
            billNumber,
            billType,
            photoType
        );

        console.log('✅ Photo uploaded successfully:', result);
        showToast('Photo uploaded successfully!', 'success');

        return result;

    } catch (error) {
        console.error('❌ Photo upload failed:', error);
        showToast(`Photo upload failed: ${error.message}`, 'error');
        throw error;
    }
}

/**
 * Get all photos for a bill
 * @param {string} billNumber - Bill number
 * @param {string} billType - Bill type (optional)
 * @returns {Promise<Array>} Array of photo records
 */
async function getBillPhotos(billNumber, billType = null) {
    try {
        if (!appState.supabaseService) {
            console.warn('Supabase service not available - using mock mode');
            return [];
        }

        return await appState.supabaseService.getBillPhotos(billNumber, billType);

    } catch (error) {
        console.error('❌ Error getting bill photos:', error);
        return [];
    }
}

/**
 * Enhanced photo upload handler for supply bills
 * Integrates with existing supply form functionality
 */
function enhanceSupplyPhotoUpload() {
    const photoInput = document.getElementById('photo-upload');
    if (!photoInput) return;

    photoInput.addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // Show preview (existing functionality)
            const reader = new FileReader();
            reader.onload = function (e) {
                const uploadedPhoto = document.getElementById('uploaded-photo');
                if (uploadedPhoto) {
                    uploadedPhoto.src = e.target.result;
                }
                const photoPreview = document.getElementById('photo-preview');
                if (photoPreview) {
                    photoPreview.classList.remove('hidden');
                }
            };
            reader.readAsDataURL(file);

            // Store file for later upload when bill is submitted
            photoInput.pendingFile = file;
            console.log('📸 Photo ready for upload:', file.name);

        } catch (error) {
            console.error('❌ Photo preview error:', error);
            showToast('Error processing photo', 'error');
        }
    });
}

/**
 * Enhanced photo upload handler for ugrai bills
 * Integrates with existing ugrai form functionality
 */
function enhanceUgraiPhotoUpload() {
    const photoInput = document.getElementById('ugrai-photo-upload');
    if (!photoInput) return;

    photoInput.addEventListener('change', async function (e) {
        const file = e.target.files[0];
        if (!file) return;

        try {
            // Show preview (existing functionality)
            const reader = new FileReader();
            reader.onload = function (e) {
                const uploadedPhoto = document.getElementById('ugrai-uploaded-photo');
                if (uploadedPhoto) {
                    uploadedPhoto.src = e.target.result;
                }
                const photoPreview = document.getElementById('ugrai-photo-preview');
                if (photoPreview) {
                    photoPreview.classList.remove('hidden');
                }
            };
            reader.readAsDataURL(file);

            // Store file for later upload when ugrai is submitted
            photoInput.pendingFile = file;
            console.log('📸 Ugrai photo ready for upload:', file.name);

        } catch (error) {
            console.error('❌ Ugrai photo preview error:', error);
            showToast('Error processing photo', 'error');
        }
    });
}

/**
 * Upload photo when supply bill is completed
 * Call this from your existing supply completion handler
 */
async function handleSupplyPhotoUpload(billData) {
    try {
        const photoInput = document.getElementById('photo-upload');
        if (!photoInput?.pendingFile) return null;

        const result = await uploadBillPhoto(
            photoInput.pendingFile,
            billData.billNumber,
            'supply',
            'completion'
        );

        // Clear pending file
        photoInput.pendingFile = null;

        return result;

    } catch (error) {
        console.error('❌ Supply photo upload error:', error);
        // Don't throw - allow bill completion to continue
        return null;
    }
}

/**
 * Upload photo when ugrai bill is completed
 * Call this from your existing ugrai completion handler
 */
async function handleUgraiPhotoUpload(ugraiData) {
    try {
        const photoInput = document.getElementById('ugrai-photo-upload');
        if (!photoInput?.pendingFile) return null;

        const result = await uploadBillPhoto(
            photoInput.pendingFile,
            ugraiData.billNumber,
            'ugrai',
            'completion'
        );

        // Clear pending file
        photoInput.pendingFile = null;

        return result;

    } catch (error) {
        console.error('❌ Ugrai photo upload error:', error);
        // Don't throw - allow ugrai completion to continue
        return null;
    }
}

/**
 * Load existing photos for edit mode and display them in the form
 * @param {string} billType - Type of bill (supply, ugrai, etc.)
 * @param {string} billNumber - Bill number
 */
async function loadExistingPhotosForEdit(billType, billNumber) {
    try {
        console.log(`📸 Loading existing photos for ${billType} bill: ${billNumber}`);

        const photos = await getBillPhotos(billNumber, billType);

        if (photos.length === 0) {
            console.log('📸 No existing photos found for bill:', billNumber);
            return;
        }

        console.log(`📸 Found ${photos.length} existing photos for bill:`, billNumber);

        // Show the first photo in the preview (most recent)
        const latestPhoto = photos[0];
        const uploadedPhoto = document.getElementById('uploaded-photo');
        const photoPreview = document.getElementById('photo-preview');

        if (uploadedPhoto && photoPreview) {
            uploadedPhoto.src = latestPhoto.photo_url;
            photoPreview.classList.remove('hidden');

            // Add a visual indicator that this is an existing photo
            // const existingIndicator = photoPreview.querySelector('.existing-photo-indicator');
            // if (!existingIndicator) {
            //     const indicator = document.createElement('div');
            //     indicator.className = 'existing-photo-indicator absolute top-2 left-2 bg-blue-500 text-white text-xs px-2 py-1 rounded';
            //     indicator.textContent = 'Existing Photo';
            //     photoPreview.style.position = 'relative';
            //     photoPreview.appendChild(indicator);
            // }

            console.log('📸 Loaded existing photo preview for bill:', billNumber);
        }

        // If there are multiple photos, you could show them all or add a gallery
        if (photos.length > 1) {
            console.log(`📸 Bill has ${photos.length} photos total. Showing latest.`);
        }

    } catch (error) {
        console.error('❌ Error loading existing photos for edit:', error);
        // Don't throw - editing should still work without photos
    }
}

/**
 * Load existing photos for ugrai edit mode and display them in the ugrai form
 * @param {string} billType - Type of bill (supply, ugrai, etc.)
 * @param {string} billNumber - Bill number
 */
async function loadExistingPhotosForUgraiEdit(billType, billNumber) {
    try {
        console.log(`📸 Loading existing ugrai photos for ${billType} bill: ${billNumber}`);

        const photos = await getBillPhotos(billNumber, billType);

        if (photos.length === 0) {
            console.log('📸 No existing ugrai photos found for bill:', billNumber);
            return;
        }

        console.log(`📸 Found ${photos.length} existing ugrai photos for bill:`, billNumber);

        // Show the first photo in the ugrai preview (most recent)
        const latestPhoto = photos[0];
        const uploadedPhoto = document.getElementById('ugrai-uploaded-photo');
        const photoPreview = document.getElementById('ugrai-photo-preview');

        if (uploadedPhoto && photoPreview) {
            uploadedPhoto.src = latestPhoto.photo_url;
            photoPreview.classList.remove('hidden');

            // Add a visual indicator that this is an existing photo
            // const existingIndicator = photoPreview.querySelector('.existing-photo-indicator');
            // if (!existingIndicator) {
            //     const indicator = document.createElement('div');
            //     indicator.className = 'existing-photo-indicator absolute top-2 left-2 bg-blue-500 text-white text-xs px-2 py-1 rounded';
            //     indicator.textContent = 'Existing Photo';
            //     photoPreview.style.position = 'relative';
            //     photoPreview.appendChild(indicator);
            // }

            console.log('📸 Loaded existing ugrai photo preview for bill:', billNumber);
        }

        // If there are multiple photos, you could show them all or add a gallery
        if (photos.length > 1) {
            console.log(`📸 Ugrai bill has ${photos.length} photos total. Showing latest.`);
        }

    } catch (error) {
        console.error('❌ Error loading existing ugrai photos for edit:', error);
        // Don't throw - editing should still work without photos
    }
}

/**
 * Display photos for a bill (for viewing/editing)
 * @param {string} billNumber - Bill number
 * @param {string} containerId - Container element ID to display photos
 */
async function displayBillPhotos(billNumber, containerId) {
    try {
        const container = document.getElementById(containerId);
        if (!container) return;

        const photos = await getBillPhotos(billNumber);

        if (photos.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-sm">No photos uploaded</p>';
            return;
        }

        container.innerHTML = photos.map(photo => `
            <div class="relative inline-block mr-2 mb-2">
                <img src="${photo.photo_url}" 
                     alt="Bill photo" 
                     class="w-20 h-20 object-cover rounded border cursor-pointer"
                     onclick="openPhotoModal('${photo.photo_url}')">
                <button onclick="deleteBillPhoto('${photo.id}')" 
                        class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 text-xs hover:bg-red-600">
                    ×
                </button>
                <p class="text-xs text-gray-500 mt-1">${new Date(photo.uploaded_at).toLocaleDateString()}</p>
            </div>
        `).join('');

    } catch (error) {
        console.error('❌ Error displaying photos:', error);
    }
}

/**
 * Delete a photo
 * @param {string} photoId - Photo ID to delete
 */
async function deleteBillPhoto(photoId) {
    try {
        if (!confirm('Are you sure you want to delete this photo?')) return;

        if (!appState.supabaseService) {
            throw new Error('Supabase service not available');
        }

        await appState.supabaseService.deleteBillPhoto(photoId);
        showToast('Photo deleted successfully', 'success');

        // Refresh the current bill photos display if visible
        // You can call displayBillPhotos again here if needed

    } catch (error) {
        console.error('❌ Error deleting photo:', error);
        showToast(`Error deleting photo: ${error.message}`, 'error');
    }
}

/**
 * Open photo in modal for full view
 * @param {string} photoUrl - Photo URL to display
 */
function openPhotoModal(photoUrl) {
    // Create a simple modal to view the full-size photo
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="relative max-w-4xl max-h-full p-4">
            <img src="${photoUrl}" alt="Bill photo" class="max-w-full max-h-full object-contain">
            <button onclick="this.parentElement.parentElement.remove()" 
                    class="absolute top-2 right-2 bg-red-500 text-white rounded-full w-8 h-8 text-lg hover:bg-red-600">
                ×
            </button>
        </div>
    `;
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
}

// Initialize enhanced photo uploads when page loads
document.addEventListener('DOMContentLoaded', function () {
    enhanceSupplyPhotoUpload();
    enhanceUgraiPhotoUpload();
});

// Ensure a render wrapper exists for supplier bills table (used in several places)
function renderCreditBillsTable() {
    // If the UGRAI-from-supplies section is visible, reload the supplier bills (credit + payment pending)
    try {
        const ugraiFromSuppliesSection = document.getElementById('ugrai-from-supplies-section');
        if (!ugraiFromSuppliesSection) return;
        // Only load if visible
        if (!ugraiFromSuppliesSection.classList.contains('hidden')) {
            loadCreditBills();
        }
    } catch (err) {
        console.error('Error in renderCreditBillsTable:', err);
    }
}
// Function to load credit bills from approved bills
/**
 * Enhanced function to load bills for Ugrai processing
 * Shows two types of bills that need attention:
 * 1. Credit bills (no payment received)
 * 2. Paid bills where received amount differs from net amount (payment pending)
 */
function loadCreditBills() {
    console.log("🔄 Loading bills from ugrai_entries (UGRAI from Supplies)");

    // Check if ugrai-from-supplies section is visible
    const ugraiFromSuppliesSection = document.getElementById('ugrai-from-supplies-section');
    if (!ugraiFromSuppliesSection || ugraiFromSuppliesSection.classList.contains('hidden')) {
        console.log("⚠️ Ugrai from Supplies section is hidden, skipping loading");
        return;
    }

    const creditBillsTable = document.getElementById('credit-bills-table');
    if (!creditBillsTable) {
        console.error("❌ Bills table not found");
        return;
    }

    // Load bills from ugrai_entries table only
    console.log("📊 Checking appState.data.ugraiEntries:", {
        exists: !!appState.data.ugraiEntries,
        isArray: Array.isArray(appState.data.ugraiEntries),
        length: appState.data.ugraiEntries?.length || 0,
        sample: appState.data.ugraiEntries?.[0]
    });

    if (!appState.data.ugraiEntries) {
        appState.data.ugraiEntries = [];
        console.log("⚠️ No ugrai entries data available yet - initializing empty array");
    }

    // Get all bills from ugrai_entries
    let supplierBills = [...appState.data.ugraiEntries];

    console.log("📦 Total bills in ugraiEntries:", supplierBills.length);

    // Sort by latest bill date at the top
    supplierBills.sort((a, b) => {
        const dateA = new Date(a.billDate || '1900-01-01');
        const dateB = new Date(b.billDate || '1900-01-01');
        return dateB - dateA; // Latest first
    });

    // Apply filters
    const retailerFilter = document.getElementById('ugrai-base-retailer-filter');
    const billFilter = document.getElementById('ugrai-base-bill-filter');

    if (retailerFilter && retailerFilter.value.trim()) {
        const retailerSearchTerm = retailerFilter.value.toLowerCase().trim();
        supplierBills = supplierBills.filter(bill =>
            (bill.retailerName || '').toLowerCase().includes(retailerSearchTerm)
        );
    }

    if (billFilter && billFilter.value.trim()) {
        const billSearchTerm = billFilter.value.toLowerCase().trim();
        supplierBills = supplierBills.filter(bill =>
            (bill.billNumber || '').toLowerCase().includes(billSearchTerm)
        );
    }

    if (!supplierBills || supplierBills.length === 0) {
        creditBillsTable.innerHTML = `
            <tr>
                <td colspan="8" class="text-center py-4">No bills available in ugrai_entries. Transfer credit bills first.</td>
            </tr>
        `;
        return;
    }

    // Render ugrai_entries bills (all are credit/pending bills)
    creditBillsTable.innerHTML = supplierBills.map(bill => {
        const netAmount = parseFloat(bill.netAmount || 0);
        const status = bill.status || 'Pending';
        const assignedTo = bill.assignedTo || 'Unassigned';

        // Status badge color
        const statusColor = status === 'Pending' ? 'bg-yellow-100 text-yellow-800' :
            status === 'Completed' ? 'bg-blue-100 text-blue-800' :
                'bg-green-100 text-green-800';

        return `
            <tr class="table-row">
                <td data-label="Bill Number">${bill.billNumber || 'N/A'}</td>
                <td data-label="Bill Date">${bill.billDate || 'N/A'}</td>
                <td data-label="Retailer Name">${bill.retailerName || 'N/A'}</td>
                <td data-label="Sector">${bill.sector || 'N/A'}</td>
                <td data-label="Net Amount">₹${netAmount.toFixed(2)}</td>
                <td data-label="Received Amount">₹0.00</td>
                <td data-label="Status"><span class="px-2 py-1 text-xs rounded ${statusColor}">${status}</span></td>
                <td data-label="Due Amount"><span class="text-red-600 font-semibold">₹${netAmount.toFixed(2)}</span></td>
            </tr>
        `;
    }).join('');

    console.log("✅ UGRAI from Supplies table populated with", supplierBills.length, "bills from ugrai_entries");
}

// Function to load all pending Ugrai bills from all sources
function loadTotalUgraiData() {
    console.log("Loading Total Ugrai: combining Ugrai Data + Ugrai from Supplies");

    // Explicitly hide any Bills Available for Ugrai content
    const ugraiFromSuppliesSection = document.getElementById('ugrai-from-supplies-section');
    if (ugraiFromSuppliesSection) {
        ugraiFromSuppliesSection.classList.add('hidden');
        console.log("✅ Explicitly hidden Ugrai from Supplies section");
    }

    // Wait a bit more for DOM to be ready
    setTimeout(async () => {
        const totalUgraiTable = document.querySelector('#total-ugrai-table');
        if (!totalUgraiTable) {
            console.error("❌ Total Ugrai table tbody not found");
            // Try to find parent elements
            const section = document.querySelector('#total-ugrai-section');
            const baseFile = document.querySelector('#ugrai-base-file');
            console.log("Debug - section exists:", !!section);
            console.log("Debug - base file exists:", !!baseFile);
            return;
        }

        console.log("✅ Total Ugrai table found, loading combined data");
        await loadCombinedUgraiData(totalUgraiTable);
    }, 50);
}

async function loadCombinedUgraiData(tableElement) {
    console.log("🔄 Loading combined Ugrai data (SQL-based)...");

    // Show loading state immediately
    tableElement.innerHTML = `
        <tr>
            <td colspan="5" class="text-center py-8">
                <div class="flex flex-col items-center justify-center space-y-4">
                    <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                    <div class="text-gray-600 font-medium">Loading Total Ugrai...</div>
                    <div class="text-gray-400 text-sm">Fetching from database...</div>
                </div>
            </td>
        </tr>
    `;

    try {
        // Use SQL-based function to get all pending bills
        const filteredBills = await loadProcessedTotalUgrai();

        console.log(`📊 Loaded ${filteredBills.length} bills from SQL function`);

        if (filteredBills.length === 0) {
            console.log("❌ No bills to display - showing empty message");
            tableElement.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center py-4">
                        <div class="text-gray-500">
                            <p class="mb-2">No pending Ugrai bills found</p>
                            <p class="text-sm">All bills filtered (completed/approved or zero amount)</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Apply sorting if sort state exists
        if (window.totalUgraiSortColumn) {
            filteredBills.sort((a, b) => {
                let aVal = a[window.totalUgraiSortColumn];
                let bVal = b[window.totalUgraiSortColumn];

                if (aVal == null) aVal = '';
                if (bVal == null) bVal = '';

                if (window.totalUgraiSortColumn === 'dueAmount') {
                    aVal = parseFloat(aVal) || 0;
                    bVal = parseFloat(bVal) || 0;
                    return window.totalUgraiSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }

                if (window.totalUgraiSortColumn === 'billDate') {
                    aVal = new Date(aVal).getTime() || 0;
                    bVal = new Date(bVal).getTime() || 0;
                    return window.totalUgraiSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }

                aVal = String(aVal).toLowerCase();
                bVal = String(bVal).toLowerCase();

                if (window.totalUgraiSortDirection === 'asc') {
                    return aVal.localeCompare(bVal);
                } else {
                    return bVal.localeCompare(aVal);
                }
            });
        }

        console.log(`✅ Displaying ${filteredBills.length} bills in table`);

        // Populate the table with SQL results
        tableElement.innerHTML = filteredBills.map(bill => {
            // Use pre-calculated dueAmount from SQL function
            const pendingAmount = `₹${parseFloat(bill.dueAmount || 0).toFixed(2)}`;

            return `
                <tr class="table-row">
                    <td data-label="Bill Number">${bill.billNumber || 'N/A'}</td>
                    <td data-label="Bill Date">${bill.billDate || 'N/A'}</td>
                    <td data-label="Retailer Name">${bill.retailerName || 'N/A'}</td>
                    <td data-label="Sector">${bill.sector || 'N/A'}</td>
                    <td data-label="Due Amount">${pendingAmount}</td>
                </tr>
            `;
        }).join('');

        console.log(`✅ Total Ugrai table populated with ${filteredBills.length} bills from SQL function`);

        // Calculate accurate total due amount
        const totalDueAmount = filteredBills.reduce((sum, bill) => {
            return sum + parseFloat(bill.dueAmount || 0);
        }, 0);

        console.log(`💰 Total Due Amount: ₹${totalDueAmount.toFixed(2)}`);

        // Show breakdown by source
        const breakdown = {};
        filteredBills.forEach(bill => {
            const source = bill.sourceTable === 'ugrai_data' ? 'Ugrai Data' : 'Ugrai from Supplies';
            breakdown[source] = (breakdown[source] || 0) + 1;
        });
        console.log("📊 Source breakdown:", breakdown);
        console.log(`📊 Total Bills: ${filteredBills.length} | Total Due Amount: ₹${totalDueAmount.toFixed(2)}`);

    } catch (error) {
        console.error('❌ Error loading Total Ugrai data:', error);
        tableElement.innerHTML = `
            <tr>
                <td colspan="5" class="text-center py-4 text-red-600">
                    Error loading bills: ${error.message}
                </td>
            </tr>
        `;
    }
}

// Function to create Ugrai entries from selected bills (credit bills and payment pending)
function createUgraiFromCreditBills(selectedBillIds) {
    if (!appState.data.approvedBills) return;

    const selectedBills = appState.data.approvedBills.filter(bill =>
        selectedBillIds.includes(bill.id)
    );

    if (selectedBills.length === 0) {
        showToast('No valid bills selected');
        return;
    }

    // Create Ugrai entries from selected bills with due amount calculation
    const ugraiEntries = selectedBills.map(bill => {
        const netAmount = parseFloat(bill.netAmount || 0);
        const receivedAmount = parseFloat(bill.receivedAmount || 0);
        const dueAmount = Math.max(0, netAmount - receivedAmount); // Calculate due amount

        return {
            id: `UG-${bill.billNumber}`,
            billNumber: bill.billNumber,
            billDate: bill.billDate,
            retailerName: bill.retailerName,
            sector: bill.sector || 'Unassigned',
            netAmount: bill.netAmount,
            receivedAmount: receivedAmount, // Pass received amount
            dueAmount: dueAmount, // Pass calculated due amount
            deliveryMethod: bill.deliveryMethod, // Pass delivery method for identification
            sourceType: 'supply', // Mark as supply-sourced
            originalSupplyBillId: bill.id, // Keep reference to original supply bill
            date: new Date().toISOString().split('T')[0],
            status: 'Pending',
            billId: bill.id
        };
    });

    // Add to appState
    appState.addUgraiEntries(ugraiEntries);

    showToast(`Created ${ugraiEntries.length} Ugrai entries from selected bills`);

    // Switch to Ugrai Issue tab
    const ugraiIssueTab = document.querySelector('[data-tab-id="ugrai-issue"]');
    if (ugraiIssueTab) {
        ugraiIssueTab.click();
    }
}

function renderDashboard() {
    if (!appState) return;
    console.log("renderDashboard called, purchaseEntries:", appState.data.purchaseEntries);

    const brandSelectElement = brandSelect;
    if (brandSelectElement) {
        brandSelectElement.innerHTML = `
                <option value="">Select</option>
                <option value="Nivea">Nivea</option>
                <option value="Loreal">Loreal</option>
            `;
    }

    const retailerSelectElement = retailerSelect;
    if (retailerSelectElement) {
        // Create dropdown container outside table constraints
        let retailerDropdown = document.getElementById('retailer-dropdown-portal');
        if (!retailerDropdown) {
            retailerDropdown = document.createElement('div');
            retailerDropdown.id = 'retailer-dropdown-portal';
            retailerDropdown.className = 'fixed bg-white border border-gray-300 rounded max-h-48 overflow-y-auto z-50 hidden shadow-lg';
            document.body.appendChild(retailerDropdown);
        }

        // Populate dropdown with all retailers
        retailerDropdown.innerHTML = appState.data.retailers.map((r, idx) =>
            `<div class="retailer-option px-3 py-2 cursor-pointer hover:bg-red-50 transition-colors duration-150" data-value="${r.name}" data-index="${idx}">
                ${r.name}
            </div>`
        ).join('');

        // Function to position and show dropdown
        const showRetailerDropdown = () => {
            const rect = retailerSelectElement.getBoundingClientRect();
            retailerDropdown.style.top = (rect.bottom + window.scrollY) + 'px';
            retailerDropdown.style.left = (rect.left + window.scrollX) + 'px';
            retailerDropdown.style.width = rect.width + 'px';
            retailerDropdown.classList.remove('hidden');
        };

        const hideRetailerDropdown = () => {
            retailerDropdown.classList.add('hidden');
        };

        // Add click handlers to options
        retailerDropdown.querySelectorAll('.retailer-option').forEach(option => {
            option.addEventListener('click', function () {
                retailerSelectElement.value = this.getAttribute('data-value');
                hideRetailerDropdown();
            });
        });

        // Setup search functionality
        retailerSelectElement.addEventListener('focus', showRetailerDropdown);

        retailerSelectElement.addEventListener('blur', () => {
            setTimeout(hideRetailerDropdown, 200);
        });

        retailerSelectElement.addEventListener('input', function () {
            const searchText = this.value.toLowerCase();
            const options = retailerDropdown.querySelectorAll('.retailer-option');

            if (retailerDropdown.classList.contains('hidden')) {
                showRetailerDropdown();
            }

            let firstMatch = null;

            // Clear all highlights first
            options.forEach(option => {
                option.classList.remove('bg-red-100', 'font-semibold');
                option.classList.add('bg-white');
            });

            // Find and highlight only the first match
            for (let option of options) {
                const text = option.getAttribute('data-value').toLowerCase();
                if (text.includes(searchText)) {
                    option.classList.add('bg-red-100', 'font-semibold');
                    option.classList.remove('bg-white');
                    firstMatch = option;
                    break;
                }
            }

            // Scroll first match into view
            if (firstMatch) {
                firstMatch.scrollIntoView({ block: 'nearest' });
            }
        });
    }

    const uniqueSectors = [...new Set(appState.data.retailers.map(r => String(r.sector)))];
    const newRetailerSectorSelectElement = document.getElementById('new-retailer-sector');
    if (newRetailerSectorSelectElement) {
        newRetailerSectorSelectElement.innerHTML = uniqueSectors.map(s => `<option value="${s}">${s}</option>`).join('') + `<option value="--- New Sector ---">--- New Sector ---</option>`;
    }

    if (retailerNameSelect) {
        retailerNameSelect.innerHTML = appState.data.retailers.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
    }

    // Populate filter dropdowns with unique values
    if (retailerNameFilter) {
        const uniqueRetailerNames = [...new Set(appState.data.retailers.map(r => r.name))].sort();
        const currentRetailerFilter = retailerNameFilter.value;

        // Populate datalist for searchable dropdown
        const retailerNameList = document.getElementById('retailer-name-list');
        if (retailerNameList) {
            retailerNameList.innerHTML = uniqueRetailerNames.map(name => `<option value="${name}">`).join('');
        }

        // Restore previous selection if it still exists
        if (currentRetailerFilter && uniqueRetailerNames.includes(currentRetailerFilter)) {
            retailerNameFilter.value = currentRetailerFilter;
        }
    }

    if (sectorFilter) {
        const currentSectorFilter = sectorFilter.value;

        // Populate datalist for searchable dropdown
        const sectorList = document.getElementById('sector-list');
        if (sectorList) {
            sectorList.innerHTML = uniqueSectors.map(s => `<option value="${s}">`).join('');
        }

        // Restore previous selection if it still exists
        if (currentSectorFilter && uniqueSectors.includes(currentSectorFilter)) {
            sectorFilter.value = currentSectorFilter;
        }
    }

    let filteredRetailers = appState.data.retailers || [];
    if (retailerNameFilter) {
        const retailerNameSearchTerm = retailerNameFilter.value.toLowerCase().trim();
        if (retailerNameSearchTerm) {
            filteredRetailers = filteredRetailers.filter(r =>
                String(r.name || '').toLowerCase().includes(retailerNameSearchTerm)
            );
        }
    }
    if (sectorFilter) {
        const sectorSearchTerm = sectorFilter.value.toLowerCase().trim();
        if (sectorSearchTerm) {
            filteredRetailers = filteredRetailers.filter(r =>
                String(r.sector || '').toLowerCase().includes(sectorSearchTerm)
            );
        }
    }

    filteredRetailers.sort((a, b) => String(a.sector || '').localeCompare(String(b.sector || '')) || String(a.name || '').localeCompare(String(b.name || '')));

    // Update count badge
    const countBadge = document.getElementById('retailer-count-badge');
    if (countBadge) {
        countBadge.textContent = `${(appState.data.retailers || []).length} Retailers`;
    }

    // Pagination logic
    const totalRetailers = filteredRetailers.length;
    window.retailerPageSize = window.retailerPageSize || '50';
    window.retailerCurrentPage = window.retailerCurrentPage || 1;
    const isAll = window.retailerPageSize === 'all';
    const pageSize = isAll ? Math.max(1, totalRetailers) : parseInt(window.retailerPageSize, 10);
    const totalPages = Math.max(1, Math.ceil(totalRetailers / pageSize));
    if (window.retailerCurrentPage > totalPages) window.retailerCurrentPage = totalPages;
    if (window.retailerCurrentPage < 1) window.retailerCurrentPage = 1;
    const startIndex = isAll ? 0 : (window.retailerCurrentPage - 1) * pageSize;
    const pageItems = isAll ? filteredRetailers : filteredRetailers.slice(startIndex, startIndex + pageSize);

    // Update pagination controls UI
    const pageInfo = document.getElementById('retailer-page-info');
    if (pageInfo) {
        const totalAll = (appState.data.retailers || []).length;
        if (totalRetailers === 0) {
            pageInfo.innerHTML = 'Showing <span class="font-semibold text-gray-800">0</span> of <span class="font-semibold text-gray-800">0</span> retailers';
        } else {
            const startDisplay = startIndex + 1;
            const endDisplay = Math.min(startIndex + pageItems.length, totalRetailers);
            pageInfo.innerHTML = `Showing <span class="font-semibold text-gray-800">${startDisplay}</span> to <span class="font-semibold text-gray-800">${endDisplay}</span> of <span class="font-semibold text-gray-800">${totalRetailers}</span> retailers${totalRetailers !== totalAll ? ` <span class="text-xs text-gray-400 font-normal">(filtered from ${totalAll})</span>` : ''}`;
        }
    }
    const pageNumber = document.getElementById('retailer-page-number');
    if (pageNumber) {
        pageNumber.textContent = `Page ${window.retailerCurrentPage} of ${totalPages}`;
    }
    const prevBtn = document.getElementById('retailer-prev-page-btn');
    if (prevBtn) {
        prevBtn.disabled = window.retailerCurrentPage <= 1;
    }
    const nextBtn = document.getElementById('retailer-next-page-btn');
    if (nextBtn) {
        nextBtn.disabled = window.retailerCurrentPage >= totalPages;
    }

    // Multi-select state & bulk toolbar UI update
    window.selectedRetailers = window.selectedRetailers || new Set();
    const bulkBar = document.getElementById('retailer-bulk-actions-bar');
    const selectedCount = window.selectedRetailers.size;
    if (bulkBar) {
        if (selectedCount > 0) {
            bulkBar.classList.remove('hidden');
            bulkBar.classList.add('flex');
            const countEl = document.getElementById('retailer-selected-count');
            if (countEl) countEl.textContent = selectedCount;
            const textEl = document.getElementById('retailer-selected-text');
            if (textEl) textEl.textContent = `${selectedCount} ${selectedCount === 1 ? 'retailer' : 'retailers'}`;
        } else {
            bulkBar.classList.add('hidden');
            bulkBar.classList.remove('flex');
        }
    }

    const selectAllCheckbox = document.getElementById('retailers-select-all');
    if (selectAllCheckbox) {
        const visibleNames = pageItems.map(r => r.name);
        selectAllCheckbox.checked = visibleNames.length > 0 && visibleNames.every(name => window.selectedRetailers.has(name));
        selectAllCheckbox.indeterminate = visibleNames.some(name => window.selectedRetailers.has(name)) && !selectAllCheckbox.checked;
    }

    if (retailerTableBody) {
        if (pageItems.length === 0) {
            retailerTableBody.innerHTML = `
                <tr class="table-row">
                    <td colspan="5" class="text-center py-8 text-gray-500">
                        ${totalRetailers === 0 && (appState.data.retailers || []).length > 0 ? 'No retailers match your search filters.' : 'No retailers found. Upload an Excel or CSV file or click "+ Add Retailer" to add.'}
                    </td>
                </tr>
            `;
        } else {
            retailerTableBody.innerHTML = pageItems.map((r, idx) => {
                const globalIndex = startIndex + idx + 1;
                const isEditing = window.editingRetailerId && (String(window.editingRetailerId) === String(r.id) || window.editingRetailerId === r.name);
                const isSelected = window.selectedRetailers.has(r.name);
                
                if (isEditing) {
                    return `
                        <tr class="table-row bg-blue-50/70 border-l-4 border-blue-600 transition-colors" data-id="${r.id || ''}">
                            <td class="py-2.5 px-3 text-center">
                                <input type="checkbox" disabled class="opacity-30 rounded w-4 h-4">
                            </td>
                            <td class="py-2.5 px-4 font-mono text-xs text-gray-500">${globalIndex}</td>
                            <td class="py-2.5 px-4">
                                <input type="text" class="edit-retailer-name-input compact-input w-full bg-white border border-blue-400 rounded-md px-2 py-1 text-sm font-semibold focus:ring-1 focus:ring-blue-500" value="${escapeHtml(r.name)}" data-original-name="${escapeHtml(r.name)}" data-id="${r.id || ''}">
                            </td>
                            <td class="py-2.5 px-4">
                                <input type="text" list="sector-list" class="edit-retailer-sector-input compact-input w-full bg-white border border-blue-400 rounded-md px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500" value="${escapeHtml(r.sector)}" data-original-sector="${escapeHtml(r.sector)}" data-id="${r.id || ''}">
                            </td>
                            <td class="py-2.5 px-4 text-center">
                                <div class="flex items-center justify-center gap-1.5">
                                    <button type="button" class="save-retailer-row-btn inline-flex items-center gap-1 text-xs bg-green-600 hover:bg-green-700 text-white font-semibold px-2.5 py-1 rounded-md shadow-xs transition" data-id="${r.id || ''}" data-original-name="${escapeHtml(r.name)}" data-original-sector="${escapeHtml(r.sector)}">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                                        <span>Save</span>
                                    </button>
                                    <button type="button" class="cancel-retailer-row-btn inline-flex items-center gap-1 text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium px-2.5 py-1 rounded-md transition" data-id="${r.id || ''}">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                                        <span>Cancel</span>
                                    </button>
                                </div>
                            </td>
                        </tr>
                    `;
                }

                return `
                    <tr class="table-row hover:bg-gray-50/80 transition-colors ${isSelected ? 'bg-red-50/40' : ''}" data-id="${r.id || ''}">
                        <td class="py-2.5 px-3 text-center" data-label="Select">
                            <input type="checkbox" class="retailer-row-checkbox rounded accent-red-600 cursor-pointer w-4 h-4" data-id="${r.id || ''}" data-name="${escapeHtml(r.name)}" ${isSelected ? 'checked' : ''}>
                        </td>
                        <td class="py-2.5 px-4 font-mono text-xs text-gray-400 select-text" data-label="#">${globalIndex}</td>
                        <td class="py-2.5 px-4 font-semibold text-gray-900 text-sm select-text" data-label="Retailer Name">${escapeHtml(r.name)}</td>
                        <td class="py-2.5 px-4 text-gray-900 text-sm font-medium select-text" data-label="Sector">
                            <span class="select-text">${escapeHtml(r.sector || 'N/A')}</span>
                        </td>
                        <td class="py-2.5 px-4 text-center" data-label="Action">
                            <div class="flex items-center justify-center gap-1.5">
                                <button type="button" class="edit-retailer-row-btn inline-flex items-center gap-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium px-2.5 py-1 rounded-md border border-blue-200 transition shadow-xs" data-id="${r.id || ''}" data-name="${escapeHtml(r.name)}" data-sector="${escapeHtml(r.sector)}">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                                    <span>Edit</span>
                                </button>
                                <button type="button" class="delete-retailer-row-btn inline-flex items-center gap-1 text-xs bg-red-50 hover:bg-red-100 text-red-700 font-medium px-2.5 py-1 rounded-md border border-red-200 transition shadow-xs" data-id="${r.id || ''}" data-name="${escapeHtml(r.name)}" data-sector="${escapeHtml(r.sector)}">
                                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                                    <span>Delete</span>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }
    }

    if (temporaryBillsTableBody) {
        temporaryBillsTableBody.innerHTML = appState.data.temporaryBills.map(bill => `
                <tr class="table-row">
                    <td data-label="Select"><input type="checkbox" class="staged-checkbox rounded accent-red-600" data-bill-id="${bill.id}"></td>
                    <td data-label="Bill Number">${bill.billNumber}</td>
                    <td data-label="Bill Date">${bill.billDate}</td>
                    <td data-label="Retailer Name">${bill.retailerName}</td>
                    <td data-label="Sector">${bill.sector || 'N/A'}</td>
                    <td data-label="Net Amount">${bill.netAmount}</td>
                    <td data-label="Actions">
                        <button class="remove-temp-bill-btn px-3 py-1 btn-red text-white rounded-lg hover:bg-red-700 transition-colors duration-300 text-xs" data-bill-id="${bill.id}">Remove</button>
                    </td>
                </tr>
            `).join('');
    }

    if (allSupplyTableBody) {
        // Generate supply assignee options
        const supplyAssignees = appState.data.supplyAssignees || [];
        console.log('🔍 renderDashboard - supplyAssignees:', supplyAssignees);
        const supplyOptions = supplyAssignees.map(assignee =>
            `<option value="${assignee.full_name}">${assignee.full_name}</option>`
        ).join('');

        // Always include "Supply" option
        const allSupplyOptions = `<option value="">Select Person</option>
                                   <option value="Supply">Supply</option>
                                   ${supplyOptions}`;
        console.log('🔍 renderDashboard - allSupplyOptions:', allSupplyOptions);

        allSupplyTableBody.innerHTML = appState.data.bills.map(bill => `
                <tr class="table-row">
                    <td data-label="Select"><input type="checkbox" class="dispatch-checkbox rounded accent-red-600" data-bill-id="${bill.id}" data-bill-number="${bill.billNumber}"></td>
                    <td data-label="Bill Number">${bill.billNumber}</td>
                    <td data-label="Bill Date">${bill.billDate}</td>
                    <td data-label="Retailer Name">${bill.retailerName}</td>
                    <td data-label="Sector">${bill.sector || 'N/A'}</td>
                    <td data-label="Net Amount">${bill.netAmount}</td>
                    <td data-label="Supply Through">
                        <select class="supply-through-select bg-gray-100 rounded-lg p-1.5 focus:outline-none focus:border-red-600">
                            ${allSupplyOptions}
                        </select>
                    </td>
                    <td data-label="Actions">
                        <button class="move-back-btn px-5 py-3 btn-red text-white rounded-lg hover:bg-red-700 transition-colors duration-300 text-xs" data-bill-id="${bill.id}">Move Back</button>
                    </td>
                </tr>
            `).join('');
    }

    const billsForApproval = appState.data.activeSupplies.filter(bill =>
        bill.status === 'delivered' || bill.status === 'cancelled' || bill.status === 'edited' ||
        bill.status === 'Delivered' || bill.status === 'Cancelled' || bill.status === 'Edited'
    );
    let suppliesInProgress = appState.data.activeSupplies.filter(bill =>
        bill.status === 'in_progress' || bill.status === 'In Progress'
    );

    // Apply sorting for Supply Management (bills for approval)
    if (window.supplyManagementSortColumn) {
        billsForApproval.sort((a, b) => {
            let aVal = a[window.supplyManagementSortColumn];
            let bVal = b[window.supplyManagementSortColumn];

            if (aVal == null) aVal = '';
            if (bVal == null) bVal = '';

            // Handle numeric columns
            if (window.supplyManagementSortColumn === 'netAmount' || window.supplyManagementSortColumn === 'receivedAmount') {
                aVal = parseFloat(aVal) || 0;
                bVal = parseFloat(bVal) || 0;
                return window.supplyManagementSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }

            // Handle date columns
            if (window.supplyManagementSortColumn === 'billDate') {
                aVal = new Date(aVal).getTime() || 0;
                bVal = new Date(bVal).getTime() || 0;
                return window.supplyManagementSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }

            // Handle text columns
            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();

            if (window.supplyManagementSortDirection === 'asc') {
                return aVal.localeCompare(bVal);
            } else {
                return bVal.localeCompare(aVal);
            }
        });
    }


    // Apply sorting for supplies in progress (if sort state exists)
    if (window.supplyProgressSortColumn) {
        suppliesInProgress.sort((a, b) => {
            let aVal = a[window.supplyProgressSortColumn];
            let bVal = b[window.supplyProgressSortColumn];

            if (aVal == null) aVal = '';
            if (bVal == null) bVal = '';

            if (window.supplyProgressSortColumn === 'netAmount') {
                aVal = parseFloat(aVal) || 0;
                bVal = parseFloat(bVal) || 0;
                return window.supplyProgressSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }

            if (window.supplyProgressSortColumn === 'billDate') {
                aVal = new Date(aVal).getTime() || 0;
                bVal = new Date(bVal).getTime() || 0;
                return window.supplyProgressSortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }

            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();

            if (window.supplyProgressSortDirection === 'asc') {
                return aVal.localeCompare(bVal);
            } else {
                return bVal.localeCompare(aVal);
            }
        });
    }

    // Apply filters for supplies in progress
    const supplyRetailerFilter = document.getElementById('supply-progress-retailer-filter');
    const supplyBillFilter = document.getElementById('supply-progress-bill-filter');
    const supplySectorFilter = document.getElementById('supply-progress-sector-filter');

    if (supplyRetailerFilter && supplyRetailerFilter.value.trim()) {
        const retailerSearchTerm = supplyRetailerFilter.value.toLowerCase();
        suppliesInProgress = suppliesInProgress.filter(bill =>
            bill.retailerName && bill.retailerName.toLowerCase().includes(retailerSearchTerm)
        );
    }

    if (supplyBillFilter && supplyBillFilter.value.trim()) {
        const billSearchTerm = supplyBillFilter.value.toLowerCase();
        suppliesInProgress = suppliesInProgress.filter(bill =>
            bill.billNumber && bill.billNumber.toLowerCase().includes(billSearchTerm)
        );
    }

    if (supplySectorFilter && supplySectorFilter.value.trim()) {
        const sectorSearchTerm = supplySectorFilter.value.toLowerCase();
        suppliesInProgress = suppliesInProgress.filter(bill =>
            bill.sector && bill.sector.toLowerCase().includes(sectorSearchTerm)
        );
    }

    console.log('🧮 Active supplies from data:', appState.data.activeSupplies);
    console.log('🎯 Filtered supplies in progress:', suppliesInProgress);
    console.log('📋 Filtered bills for approval:', billsForApproval);

    // Update how the button is rendered in todaysSuppliesTableBody
    if (todaysSuppliesTableBody) {
        if (suppliesInProgress.length === 0) {
            todaysSuppliesTableBody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500">No supplies found</td></tr>';
        } else {
            todaysSuppliesTableBody.innerHTML = suppliesInProgress.map(bill => {
                const actionButton = `
                <button 
                    class="supply-done-btn bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors duration-300 text-xs" 
                    data-bill-number="${bill.billNumber}"
                >
                    Supply Done
                </button>`;

                return `
            <tr class="table-row">
                <td data-label="Bill Number">${bill.billNumber}</td>
                <td data-label="Bill Date">${bill.billDate}</td>
                <td data-label="Retailer Name">${bill.retailerName}</td>
                <td data-label="Sector">${bill.sector || 'N/A'}</td>
                <td data-label="Net Amount">${bill.netAmount}</td>
                <td data-label="Supply Through">${bill.supplyThrough}</td>
                <td data-label="Actions">${actionButton}</td>
            </tr>`;
            }).join('');
        }
    }

    if (billsForApprovalTableBody) {
        // First, render the table with loading placeholders for photos
        billsForApprovalTableBody.innerHTML = billsForApproval.map(bill => {
            let statusText = bill.status;
            let receivedAmount = bill.netAmount; // Default to net amount

            if (bill.status === 'Delivered') {
                statusText = bill.deliveryMethod || 'Cash';
                // For credit bills, show 0 as received amount
                if (bill.deliveryMethod === 'Credit' || bill.paymentMethod === 'Credit') {
                    receivedAmount = 0;
                } else {
                    receivedAmount = bill.receivedAmount || bill.netAmount;
                }
            } else if (bill.paymentMethod === 'Credit') {
                // For any bill marked as Credit, show 0 received amount
                receivedAmount = 0;
            }

            // Add Revert button only for Delivered bills
            const revertButton = bill.status === 'Delivered' ? `
            <button class="revert-supply-btn px-2 py-1 bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors duration-300 text-xs" 
                    data-bill-number="${bill.billNumber}" title="Revert to In Progress">Revert</button>
            ` : '';

            const actionButtons = `
        <div class="flex gap-1 flex-wrap">
            <button class="edit-approval-btn px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors duration-300 text-xs" 
                    data-bill-number="${bill.billNumber}">Edit</button>
            <button class="approve-bill-btn px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors duration-300 text-xs" 
                    data-bill-number="${bill.billNumber}">Approve</button>
            ${revertButton}
        </div>
    `;

            // Photo column with loading placeholder - will be populated asynchronously
            const photoColumn = `
                <div class="supply-photo-cell" data-bill-number="${bill.billNumber}">
                    <div class="inline-flex items-center justify-center">
                        <svg class="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    </div>
                </div>
            `;

            return `
                <tr class="table-row">
                    <td data-label="Select">
                        <input type="checkbox" class="approval-checkbox rounded accent-red-600" 
                            data-bill-id="${bill.id}" data-bill-number="${bill.billNumber}">
                    </td>
                    <td data-label="Bill Number">${bill.billNumber}</td>
                    <td data-label="Bill Date">${bill.billDate}</td>
                    <td data-label="Retailer Name">${bill.retailerName}</td>
                    <td data-label="Sector">${bill.sector || 'N/A'}</td>
                    <td data-label="Net Amount">₹${parseFloat(bill.netAmount || 0).toFixed(2)}</td>
                    <td data-label="Received Amount">₹${parseFloat(receivedAmount || 0).toFixed(2)}</td>
                    <td data-label="Status">${statusText}</td>
                    <td data-label="Photo" class="text-center">${photoColumn}</td>
                    <td data-label="Actions">${actionButtons}</td>
                </tr>
                `;
        }).join('');

        // Now fetch photos from bill_photos table asynchronously for each bill
        loadSupplyManagementPhotos(billsForApproval);
    }

    // Calculate totals for Supply Management cards based on RECEIVED amounts
    const totalBills = billsForApproval.length;
    const totalAmount = billsForApproval.reduce((sum, bill) => {
        // Use receivedAmount if available, otherwise use netAmount
        const amountToUse = bill.receivedAmount || bill.netAmount;
        return sum + parseFloat(amountToUse || 0);
    }, 0);

    // Totals by delivery method (using RECEIVED amounts)
    const cashBills = billsForApproval.filter(b => b.deliveryMethod === 'Cash');
    const totalCash = cashBills.reduce((sum, bill) => {
        const amountToUse = bill.receivedAmount || bill.netAmount;
        return sum + parseFloat(amountToUse || 0);
    }, 0);
    const cashCount = cashBills.length;

    const creditBills = billsForApproval.filter(b => b.deliveryMethod === 'Credit');
    const totalCredit = creditBills.reduce((sum, bill) => {
        const amountToUse = bill.receivedAmount || bill.netAmount;
        return sum + parseFloat(amountToUse || 0);
    }, 0);
    const creditCount = creditBills.length;

    const upiBills = billsForApproval.filter(b => b.deliveryMethod === 'UPI');
    const totalUPI = upiBills.reduce((sum, bill) => {
        const amountToUse = bill.receivedAmount || bill.netAmount;
        return sum + parseFloat(amountToUse || 0);
    }, 0);
    const upiCount = upiBills.length;

    const chequeBills = billsForApproval.filter(b => b.deliveryMethod === 'Cheque');
    const totalCheque = chequeBills.reduce((sum, bill) => {
        const amountToUse = bill.receivedAmount || bill.netAmount;
        return sum + parseFloat(amountToUse || 0);
    }, 0);
    const chequeCount = chequeBills.length;

    const cancelledBills = billsForApproval.filter(b => b.status === 'Cancelled');
    const totalCancelled = cancelledBills.reduce((sum, bill) => {
        return sum + parseFloat(bill.netAmount || 0); // Cancelled bills use net amount
    }, 0);
    const cancelledCount = cancelledBills.length;

    const editedBills = appState.data.editedBills || [];
    const totalEdited = editedBills.reduce((sum, bill) => {
        return sum + parseFloat(bill.netAmount || 0); // Edited bills use net amount
    }, 0);
    const editedCount = editedBills.length;

    // Update summary cards
    const totalBillsElement = document.getElementById('total-bills-count');
    if (totalBillsElement) totalBillsElement.textContent = totalBills;

    const totalReceivedElement = document.getElementById('total-received-amount');
    if (totalReceivedElement) totalReceivedElement.textContent = `₹${totalAmount.toFixed(2)}`;

    const cashReceivedElement = document.getElementById('cash-received');
    if (cashReceivedElement) cashReceivedElement.textContent = `₹${totalCash.toFixed(2)}`;
    const cashCountElement = document.getElementById('cash-count');
    if (cashCountElement) cashCountElement.textContent = `(${cashCount})`;

    const creditReceivedElement = document.getElementById('credit-received');
    if (creditReceivedElement) creditReceivedElement.textContent = `₹${totalCredit.toFixed(2)}`;
    const creditCountElement = document.getElementById('credit-count');
    if (creditCountElement) creditCountElement.textContent = `(${creditCount})`;

    const upiReceivedElement = document.getElementById('upi-received');
    if (upiReceivedElement) upiReceivedElement.textContent = `₹${totalUPI.toFixed(2)}`;
    const upiCountElement = document.getElementById('upi-count');
    if (upiCountElement) upiCountElement.textContent = `(${upiCount})`;

    const chequeReceivedElement = document.getElementById('cheque-received');
    if (chequeReceivedElement) chequeReceivedElement.textContent = `₹${totalCheque.toFixed(2)}`;
    const chequeCountElement = document.getElementById('cheque-count');
    if (chequeCountElement) chequeCountElement.textContent = `(${chequeCount})`;

    const cancelledReceivedElement = document.getElementById('cancelled-received');
    if (cancelledReceivedElement) cancelledReceivedElement.textContent = `₹${totalCancelled.toFixed(2)}`;
    const cancelledCountElement = document.getElementById('cancelled-count');
    if (cancelledCountElement) cancelledCountElement.textContent = `(${cancelledCount})`;

    const editedReceivedElement = document.getElementById('edited-received');
    if (editedReceivedElement) editedReceivedElement.textContent = `₹${totalEdited.toFixed(2)}`;
    const editedCountElement = document.getElementById('edited-count');
    if (editedCountElement) editedCountElement.textContent = `(${editedCount})`;

    // Render edited bills if that section is visible
    if (document.getElementById('edited-bills-form') && !document.getElementById('edited-bills-form').classList.contains('hidden')) {
        loadEditedBills();
    }

    // Check if Ugrai in Progress tab is visible and update assigned bills
    const ugraiInProgressTab = document.getElementById('ugrai-in-progress');
    if (ugraiInProgressTab && window.getComputedStyle(ugraiInProgressTab).display !== 'none') {
        // Use async version to filter ghost bills, fallback to sync if needed
        if (!mockMode && appState.supabaseService) {
            renderAssignedUgraiBillsTable().catch(error => {
                console.warn('⚠️ Async UGRAI rendering failed, using sync version:', error);
                renderAssignedUgraiBillsTableSync();
            });
        } else {
            renderAssignedUgraiBillsTableSync(); // Use sync version for mock mode
        }
    }

    // Check if UGRAI Management tab is visible OR UGRAI In Progress tab is visible for management data
    const ugraiManagementTab = document.getElementById('ugrai-management');
    const showUgraiManagement = (ugraiInProgressTab && window.getComputedStyle(ugraiInProgressTab).display !== 'none') ||
        (ugraiManagementTab && window.getComputedStyle(ugraiManagementTab).display !== 'none');

    console.log('🔍 UGRAI Management visibility check:', {
        ugraiInProgressVisible: ugraiInProgressTab ? window.getComputedStyle(ugraiInProgressTab).display !== 'none' : false,
        ugraiManagementVisible: ugraiManagementTab ? window.getComputedStyle(ugraiManagementTab).display !== 'none' : false,
        showUgraiManagement
    });

    if (showUgraiManagement) {
        // For Ugrai Management
        const allCompletedUgrai = appState.data.completedUgrai || [];

        // Basic validation to ensure it's a proper completed bill
        const completedUgrai = allCompletedUgrai.filter(bill => {
            const isValid = bill.billNumber &&
                bill.retailerName &&
                bill.paymentMethod &&
                bill.receivedAmount !== undefined &&
                bill.dateCompleted;

            if (!isValid) {
                console.log('⚠️ Filtering out invalid/ghost bill during render:', bill.billNumber || 'unknown');
            }

            return isValid;
        });

        console.log('🎯 Rendering UGRAI Management:', completedUgrai.length, 'bills');

        // Update Ugrai Management summary cards
        const totalUgraiBills = completedUgrai.length;
        const totalUgraiAmount = completedUgrai.reduce((sum, bill) => {
            const amountToUse = parseFloat(bill.receivedAmount || bill.netAmount || 0);
            return sum + amountToUse;
        }, 0);

        // Update summary cards by payment method
        const ugraiByMethod = {
            'Cash': { count: 0, amount: 0 },
            'UPI': { count: 0, amount: 0 },
            'Cheque': { count: 0, amount: 0 },
            'NEFT': { count: 0, amount: 0 }
        };

        completedUgrai.forEach(bill => {
            const method = bill.paymentMethod || 'Unknown';
            const amount = parseFloat(bill.receivedAmount || bill.netAmount || 0);

            if (ugraiByMethod[method]) {
                ugraiByMethod[method].count += 1;
                ugraiByMethod[method].amount += amount;
            }
        });

        // Update the UI elements for the totals
        const totalBillsElement = document.getElementById('ugrai-total-bills-count');
        if (totalBillsElement) totalBillsElement.textContent = totalUgraiBills;

        const totalReceivedElement = document.getElementById('ugrai-total-received-amount');
        if (totalReceivedElement) totalReceivedElement.textContent = `₹${totalUgraiAmount.toFixed(2)}`;

        // Update each payment method card
        Object.keys(ugraiByMethod).forEach(method => {
            const lowerMethod = method.toLowerCase();
            const countElement = document.getElementById(`ugrai-${lowerMethod}-count`);
            const amountElement = document.getElementById(`ugrai-${lowerMethod}-received`);

            if (countElement) countElement.textContent = `(${ugraiByMethod[method].count})`;
            if (amountElement) amountElement.textContent = `₹${ugraiByMethod[method].amount.toFixed(2)}`;
        });

        // Render the approval table
        const ugraiForApprovalTable = document.getElementById('ugrai-for-approval-table');
        if (ugraiForApprovalTable) {
            console.log('🔍 UGRAI Management table data:', completedUgrai.map(bill => ({
                id: bill.id,
                billNumber: bill.billNumber,
                retailerName: bill.retailerName,
                paymentMethod: bill.paymentMethod,
                receivedAmount: bill.receivedAmount
            })));

            if (completedUgrai.length === 0) {
                ugraiForApprovalTable.innerHTML = `
            <tr>
                <td colspan="11" class="text-center py-4">No ugrai bills pending approval</td>
            </tr>
        `;
            } else {
                ugraiForApprovalTable.innerHTML = completedUgrai.map(bill => {
                    // Photo column with loading placeholder - will be populated asynchronously
                    const photoColumn = `
                        <div class="ugrai-photo-cell" data-bill-number="${bill.billNumber}">
                            <div class="inline-flex items-center justify-center">
                                <svg class="animate-spin h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            </div>
                        </div>
                    `;

                    return `
            <tr class="table-row">
                <td data-label="Select">
                    <input type="checkbox" class="ugrai-approval-checkbox rounded accent-red-600" 
                        data-bill-id="${bill.id || bill.billNumber}">
                </td>
                <td data-label="Bill Number">${bill.billNumber || 'N/A'}</td>
                <td data-label="Bill Date">${bill.billDate || 'N/A'}</td>
                <td data-label="Retailer Name">${bill.retailerName || 'N/A'}</td>
                <td data-label="Sector">${bill.sector || 'N/A'}</td>
                <td data-label="Assigned To">${bill.assignedTo || bill.assigned_to || bill.completedBy || bill.completed_by || 'N/A'}</td>
                <td data-label="Net Amount">₹${parseFloat(bill.netAmount || 0).toFixed(2)}</td>
                <td data-label="Received Amount">₹${parseFloat(bill.receivedAmount || bill.netAmount || 0).toFixed(2)}</td>
                <td data-label="Payment Method">${bill.paymentMethod || 'N/A'}</td>
                <td data-label="Photo" class="text-center">${photoColumn}</td>
                <td data-label="Actions">
                    <div class="flex gap-1 flex-wrap">
                        <button class="revert-ugrai-btn px-2 py-1 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors duration-300 text-xs"
                                data-bill-id="${bill.id || bill.billNumber}">Revert</button>
                        <button class="edit-ugrai-btn px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors duration-300 text-xs"
                                data-bill-id="${bill.id || bill.billNumber}">Edit</button>
                        <button class="approve-ugrai-btn px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors duration-300 text-xs"
                                data-bill-id="${bill.id || bill.billNumber}">Approve</button>
                    </div>
                </td>
            </tr>
        `;
                }).join('');

                // Load photos asynchronously after table is rendered
                loadUgraiManagementPhotos(completedUgrai);
            }

            // Populate sector dropdown with unique sectors
            populateUgraiManagementSectorFilter(completedUgrai);

            // Initialize filters
            initializeUgraiManagementFilters(completedUgrai);
        }
    }
    // Render Ugrai Issue tables if that tab is visible
    const ugraiIssueTab = document.getElementById('ugrai-issue');
    if (ugraiIssueTab && window.getComputedStyle(ugraiIssueTab).display !== 'none') {
        // Initialize default persons if not set yet (for mock mode)
        if (mockMode && (!appState.data.persons || appState.data.persons.length === 0)) {
            appState.data.persons = ['Mohan', 'Suresh', 'Rahul'];
        }

        // Render sector totals table
        renderSectorTotalsTable().catch(err => console.error('Error rendering sector totals:', err));

        // Render assigned Ugrai bills table
        renderAssignedUgraiBillsTableSync(); // Use sync version for immediate render
    }

    // Also render Ugrai data table if that section is visible
    const ugraiDataSection = document.getElementById('ugrai-data-section');
    const ugraiDataTableContainer = document.getElementById('ugrai-data-table-container');
    if (ugraiDataSection && ugraiDataTableContainer && !ugraiDataSection.classList.contains('hidden') &&
        !ugraiDataTableContainer.classList.contains('hidden')) {
        renderUgraiTable(appState.data.ugraiData || []);
    }

    // Render credit bills table if that section is visible
    const ugraiFromSuppliesSection = document.getElementById('ugrai-from-supplies-section');
    if (ugraiFromSuppliesSection && !ugraiFromSuppliesSection.classList.contains('hidden')) {
        loadCreditBills();
    }
    // Render Purchase data
    const purchaseRetailerTable = document.getElementById('purchase-retailer-table');
    console.log('🔍 renderDashboard - Purchase table element found:', !!purchaseRetailerTable);
    console.log('🔍 renderDashboard - Purchase data available:', appState.data.purchaseRetailers?.length || 0);

    if (purchaseRetailerTable) {
        let filteredPurchaseRetailers = appState.data.purchaseRetailers || [];
        console.log('🔍 renderDashboard - Filtered retailers:', filteredPurchaseRetailers.length);

        const purchaseRetailerFilter = document.getElementById('purchase-retailer-filter');
        if (purchaseRetailerFilter && purchaseRetailerFilter.value.trim()) {
            const searchTerm = purchaseRetailerFilter.value.toLowerCase();
            filteredPurchaseRetailers = filteredPurchaseRetailers.filter(r =>
                r.retailerName.toLowerCase().includes(searchTerm)
            );
            console.log('🔍 renderDashboard - After filtering:', filteredPurchaseRetailers.length);
        }

        const tableHTML = filteredPurchaseRetailers.map(r => `
            <tr class="table-row">
                <td data-label="Retailer Name">${r.retailerName}</td>
                <td data-label="Due Days">${r.dueDays}</td>
            </tr>
        `).join('') || '<tr><td colspan="2" class="text-center py-4">No retailers found</td></tr>';

        purchaseRetailerTable.innerHTML = tableHTML;
        console.log('🔍 renderDashboard - Table HTML set:', tableHTML.substring(0, 100) + '...');
    }

    // Purchase tables are now handled by enhancePurchaseTables()
    if (typeof window.enhancePurchaseTables === 'function') {
        window.enhancePurchaseTables();
    } else if (typeof enhancePurchaseTables === 'function') {
        enhancePurchaseTables();
    } else {
        console.warn('enhancePurchaseTables function not yet available');
    }

    // CRITICAL FIX: Always render UGRAI In Progress bills after data is loaded
    console.log('📊 Rendering UGRAI In Progress bills from renderDashboard...');
    if (typeof renderAssignedUgraiBillsTableSync === 'function') {
        renderAssignedUgraiBillsTableSync();
    }
}

// Render Ugrai Issue tables if that tab is visible
const ugraiIssueTab = document.getElementById('ugrai-issue');
if (ugraiIssueTab && window.getComputedStyle(ugraiIssueTab).display !== 'none') {
    // Initialize default persons if not set yet (for mock mode)
    if (mockMode && (!appState.data.persons || appState.data.persons.length === 0)) {
        appState.data.persons = ['Mohan', 'Suresh', 'Rahul'];
    }

    // Use coordinated render to prevent duplicate loading states
    renderUgraiIssueCoordinated().catch(err => console.error('Error rendering UGRAI Issue:', err));
}

// Also render Ugrai data table if that section is visible
const ugraiDataSection = document.getElementById('ugrai-data-section');
const ugraiDataTableContainer = document.getElementById('ugrai-data-table-container');
if (ugraiDataSection && ugraiDataTableContainer && !ugraiDataSection.classList.contains('hidden') &&
    !ugraiDataTableContainer.classList.contains('hidden')) {
    renderUgraiTable(appState.data.ugraiData || []);
}

// Render credit bills table if that section is visible
const ugraiFromSuppliesSection = document.getElementById('ugrai-from-supplies-section');
if (ugraiFromSuppliesSection && !ugraiFromSuppliesSection.classList.contains('hidden')) {
    loadCreditBills();
}
window.addEventListener('load', async function () {
    // Check authentication first - redirect to login if not authenticated
    try {
        // Check if user just logged out
        const logoutFlag = localStorage.getItem('logout_flag');
        if (logoutFlag === 'true') {
            console.log('User logged out, redirecting to login...');
            localStorage.removeItem('logout_flag');
            window.location.replace('login.html');
            return;
        }

        if (window.__supabase_url && window.__supabase_anon_key && window.supabase) {
            const supabase = window.supabase.createClient(
                window.__supabase_url,
                window.__supabase_anon_key,
                {
                    auth: {
                        persistSession: true,
                        autoRefreshToken: true,
                        detectSessionInUrl: true,
                        storage: window.localStorage,
                        flowType: 'pkce'
                    }
                }
            );
            const { data: { session }, error } = await supabase.auth.getSession();

            if (error) {
                console.error('Session check error:', error);
                window.location.replace('login.html');
                return;
            }

            if (!session || !session.user) {
                console.log('No active session found, redirecting to login...');
                window.location.replace('login.html');
                return;
            }

            console.log('User authenticated:', session.user.email);
        } else {
            console.log('No Supabase configuration found, allowing access in development mode');
        }
    } catch (error) {
        console.error('Authentication check failed:', error);
        console.log('Redirecting to login due to authentication error...');
        window.location.replace('login.html');
        return;
    }

    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.className = savedTheme;

    initDOMReferences();
    initEventListeners();
    updateToggleBallPosition(savedTheme);

    // Load assignees from database for dropdowns
    await loadAssigneesFromDatabase();

    // Wait for RBAC to be ready before rendering default content
    const waitForRBAC = setInterval(() => {
        if (window.rbacService) {
            clearInterval(waitForRBAC);

            // Find first allowed section for user
            const allowedSections = ['supply', 'ugrai', 'purchase', 'analysis'].filter(section =>
                window.rbacService.hasAnyPermissionInSection(section)
            );

            const defaultSection = allowedSections.length > 0 ? allowedSections[0] : 'supply';
            console.log(`🔐 RBAC ready - rendering default section: ${defaultSection}`);

            // Show Cash Receipt tab for admin/accountant users
            showCashReceiptTabIfAuthorized();

            renderMainContent(defaultSection);
            renderSubProcesses(defaultSection);
        }
    }, 50); // Check every 50ms

    // Fallback: if RBAC doesn't load within 3 seconds, render supply anyway
    setTimeout(() => {
        if (!window.rbacService) {
            clearInterval(waitForRBAC);
            console.warn('⚠️ RBAC timeout - rendering default supply section');
            renderMainContent('supply');
            renderSubProcesses('supply');
        }
    }, 3000);

    try {
        // Check if we should use Supabase (no Firebase config = use Supabase)
        if (!firebaseConfig || Object.keys(firebaseConfig).length === 0 || !firebaseConfig.apiKey) {
            console.log("No Firebase config found, attempting to use Supabase");
            mockMode = false; // Try Supabase first
            userId = 'default-user'; // Default user until auth is implemented
            if (userIdDisplay) {
                userIdDisplay.textContent = `User ID: ${userId} (Google Sheets Mode)`;
            }
            if (navUserIdDisplay) {
                navUserIdDisplay.textContent = userId;
            }

            // Initialize with Supabase
            appState = new SupabaseAppState();
            // Make appState globally available for debugging  
            window.appState = appState;
            await appState.init();

            // If Supabase failed, mockMode will be set to true in the init method
            if (mockMode && userIdDisplay) {
                userIdDisplay.textContent = `User ID: ${userId} (Mock Mode - Backend Fallback)`;
                if (navUserIdDisplay) {
                    navUserIdDisplay.textContent = userId;
                }
            } else if (userIdDisplay) {
                // Update display with connection status
                const statusIcon = appState.connectionStatus === 'connected' ? '🟢' :
                    appState.connectionStatus === 'error' ? '🔴' : '🟡';
                userIdDisplay.textContent = `${statusIcon} User ID: ${userId} (Google Sheets Mode)`;
                if (navUserIdDisplay) {
                    navUserIdDisplay.textContent = userId;
                }
            }

            // Initialize UGRAI functionality after AppState is initialized
            if (typeof initUgraiFunctionality === 'function') {
                initUgraiFunctionality();
            }

            // Initialize purchase functionality immediately
            if (typeof setupNetAmountCalculation === 'function') {
                setupNetAmountCalculation();
            }
            if (typeof setupPurchaseEditButtons === 'function') {
                setupPurchaseEditButtons();
            }

            // Now render the dashboard after everything is set up
            if (typeof renderDashboard === 'function') {
                renderDashboard();
            }

        } else {
            console.log("Firebase config found, using Firebase mode");
            mockMode = false;
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);

            await setPersistence(auth, browserSessionPersistence);

            if (initialAuthToken) {
                await signInWithCustomToken(auth, initialAuthToken);
            } else {
                await signInAnonymously(auth);
            }

            onAuthStateChanged(auth, (user) => {
                if (user) {
                    userId = user.uid;
                    if (userIdDisplay) {
                        userIdDisplay.textContent = `User ID: ${userId} (Firebase Mode)`;
                    }
                    if (navUserIdDisplay) {
                        navUserIdDisplay.textContent = userId;
                    }
                    if (!appState) {
                        appState = new AppState(); // Use original AppState for Firebase
                        appState.init();

                        if (typeof initUgraiFunctionality === 'function') {
                            initUgraiFunctionality();
                        }

                        // Initialize purchase functionality immediately
                        if (typeof setupNetAmountCalculation === 'function') {
                            setupNetAmountCalculation();
                        }
                        if (typeof setupPurchaseEditButtons === 'function') {
                            setupPurchaseEditButtons();
                        }

                        if (toastMessage) {
                            showToast(`Running with Firebase`);
                        }
                    }

                } else {
                    console.error("User is signed out");
                    userId = null;
                    if (userIdDisplay) {
                        userIdDisplay.textContent = 'User ID: N/A';
                    }
                    if (navUserIdDisplay) {
                        navUserIdDisplay.textContent = 'N/A';
                    }
                }
            });
        }
    } catch (error) {
        console.error("Initialization error:", error);
        console.log("Falling back to mock mode");
        mockMode = true;
        userId = 'mock-user-fallback-' + Date.now();
        if (userIdDisplay) {
            userIdDisplay.textContent = `User ID: ${userId} (Mock Mode - Fallback)`;
        }
        if (navUserIdDisplay) {
            navUserIdDisplay.textContent = userId;
        }
        appState = new SupabaseAppState(); // Use SupabaseAppState even in fallback mode
        window.appState = appState; // Make globally available
        appState.init();

        if (typeof initUgraiFunctionality === 'function') {
            initUgraiFunctionality();
        }

        // Initialize purchase functionality immediately
        if (typeof setupNetAmountCalculation === 'function') {
            setupNetAmountCalculation();
        }
        if (typeof setupPurchaseEditButtons === 'function') {
            setupPurchaseEditButtons();
        }

        // Render dashboard after everything is initialized
        if (typeof renderDashboard === 'function') {
            renderDashboard();
        }

        if (toastMessage) {
            showToast(`Running offline - data won't be saved permanently`);
        }
        // Initialize UGRAI functionality after AppState is initialized
        setTimeout(() => {
            if (appState) {
                initUgraiFunctionality();
            }
        }, 500);
    }
    // Purchase functionality is now initialized immediately after appState creation
    // No need for setInterval checks
});

// Debug functions for testing
window.debugRetailerUpload = function () {
    console.log('🔧 Debug Information:');
    console.log('📋 Current retailers in appState:', appState?.data?.retailers?.length || 'N/A');
    console.log('🔗 AppState available:', !!appState);
    console.log('🏪 Supabase service available:', !!appState?.supabaseService);
    console.log('👤 User ID:', appState?.supabaseService?.userId || 'N/A');
    console.log('📁 File input element:', !!document.getElementById('retailer-base-file-upload'));
    console.log('📡 Mock mode:', mockMode);
};

// Debug function for UGRAI completion persistence
window.debugUgraiPersistence = async function () {
    console.log('🔧 UGRAI Persistence Debug:');
    console.log('📡 Mock mode:', mockMode);
    console.log('🔗 AppState available:', !!appState);
    console.log('🏪 Supabase service available:', !!appState?.supabaseService);
    console.log('👤 User ID:', appState?.supabaseService?.userId || 'N/A');
    console.log('📊 Local completed UGRAI count:', appState?.data?.completedUgrai?.length || 0);

    // Show current completed UGRAI bills
    if (appState?.data?.completedUgrai?.length > 0) {
        console.log('📋 Current completed UGRAI bills:');
        appState.data.completedUgrai.forEach((bill, index) => {
            console.log(`  ${index + 1}. ${bill.billNumber} - ${bill.retailerName} - ₹${bill.receivedAmount} (${bill.paymentMethod}) [ID: ${bill.id}]`);
        });
    } else {
        console.log('📋 No completed UGRAI bills in local data');
    }

    if (appState && appState.refreshCompletedUgraiData) {
        console.log('🔄 Refreshing completed UGRAI data from Supabase...');
        const freshData = await appState.refreshCompletedUgraiData();
        console.log('✅ Fresh data count:', freshData?.length || 0);

        // Show fresh data
        if (freshData?.length > 0) {
            console.log('📋 Fresh completed UGRAI bills from database:');
            freshData.forEach((bill, index) => {
                console.log(`  ${index + 1}. ${bill.billNumber} - ${bill.retailerName} - ₹${bill.receivedAmount} (${bill.paymentMethod}) [ID: ${bill.id}]`);
            });
        }

        return freshData;
    } else {
        console.log('❌ No refresh method available');
        return [];
    }
};

// Function to clear unwanted sample/test data
window.clearSampleUgraiData = async function () {
    if (!appState) {
        console.log('❌ AppState not available');
        return;
    }

    console.log('🧹 Checking for sample/test UGRAI data to clear...');

    if (appState.data.completedUgrai && appState.data.completedUgrai.length > 0) {
        const beforeCount = appState.data.completedUgrai.length;

        // Filter out any bills that might be sample data (look for common test patterns)
        const filteredData = appState.data.completedUgrai.filter(bill => {
            const isSample =
                (bill.billNumber && (
                    bill.billNumber.includes('SAMPLE') ||
                    bill.billNumber.includes('TEST') ||
                    bill.billNumber.includes('DEMO') ||
                    bill.retailerName === 'Sample Retailer' ||
                    bill.retailerName === 'Test Store'
                ));

            if (isSample) {
                console.log('🗑️ Found sample data to remove:', bill.billNumber, '-', bill.retailerName);
            }

            return !isSample;
        });

        appState.data.completedUgrai = filteredData;
        const afterCount = appState.data.completedUgrai.length;

        console.log(`✅ Cleared ${beforeCount - afterCount} sample records. Remaining: ${afterCount}`);
        renderDashboard();

        return { before: beforeCount, after: afterCount, cleared: beforeCount - afterCount };
    } else {
        console.log('📋 No completed UGRAI data to clear');
        return { before: 0, after: 0, cleared: 0 };
    }
};

// Function to clean up ghost bills (already approved bills)
window.cleanupGhostBills = async function () {
    if (!appState || !appState.cleanupGhostBills) {
        console.log('❌ AppState or cleanup method not available');
        return;
    }

    console.log('👻 Starting ghost bill cleanup...');
    const result = await appState.cleanupGhostBills();
    console.log('✅ Ghost bill cleanup completed:', result);
    return result;
};

// Function to check for potential ghost bills
window.checkForGhostBills = async function () {
    if (!appState || !appState.supabaseService) {
        console.log('❌ AppState or Supabase service not available');
        return;
    }

    console.log('🔍 Checking for potential ghost bills...');

    const allArrays = [
        { name: 'ugraiData', data: appState.data.ugraiData || [] },
        { name: 'ugraiEntries', data: appState.data.ugraiEntries || [] },
        { name: 'completedUgrai', data: appState.data.completedUgrai || [] }
    ];

    let totalGhosts = 0;
    const ghostBills = [];

    for (const array of allArrays) {
        console.log(`🔍 Checking ${array.name} (${array.data.length} bills)...`);

        for (const bill of array.data) {
            if (bill.billNumber) {
                const isApproved = await appState.supabaseService.getApprovedUgraiByBillNumber(bill.billNumber);
                if (isApproved) {
                    totalGhosts++;
                    const ghostInfo = {
                        billNumber: bill.billNumber,
                        retailerName: bill.retailerName,
                        array: array.name,
                        approvedOn: isApproved.date_approved
                    };
                    ghostBills.push(ghostInfo);
                    console.log(`👻 GHOST BILL FOUND in ${array.name}:`, bill.billNumber, '- approved on', isApproved.date_approved);
                }
            }
        }
    }

    console.log(`🎯 Ghost bill check complete: Found ${totalGhosts} ghost bills`);

    if (ghostBills.length > 0) {
        console.log('👻 Ghost bills summary:');
        ghostBills.forEach((ghost, index) => {
            console.log(`  ${index + 1}. ${ghost.billNumber} (${ghost.retailerName}) in ${ghost.array} - approved on ${ghost.approvedOn}`);
        });

        console.log('💡 To clean up these ghost bills, run: cleanupGhostBills()');
    }

    return { total: totalGhosts, bills: ghostBills };
};

// Function to specifically clean up UGRAI In Progress display
window.cleanupUgraiInProgress = async function () {
    if (!appState || !appState.supabaseService) {
        console.log('❌ AppState or Supabase service not available');
        return;
    }

    console.log('🧹 Cleaning up UGRAI In Progress display...');

    // Trigger the async rendering which will filter ghost bills
    try {
        await renderAssignedUgraiBillsTable();
        console.log('✅ UGRAI In Progress cleaned up successfully');
    } catch (error) {
        console.error('❌ Error cleaning up UGRAI In Progress:', error);
        // Fallback to sync version
        renderAssignedUgraiBillsTableSync();
        console.log('⚠️ Used fallback sync rendering');
    }
};

// Comprehensive function to clean up all UGRAI ghost bills and refresh displays
window.fullUgraiCleanup = async function () {
    if (!appState) {
        console.log('❌ AppState not available');
        return;
    }

    console.log('🚀 Starting comprehensive UGRAI cleanup...');

    try {
        // Step 1: Check for ghost bills
        console.log('Step 1: Checking for ghost bills...');
        const ghostCheck = await checkForGhostBills();

        if (ghostCheck.total > 0) {
            // Step 2: Clean up ghost bills from arrays
            console.log('Step 2: Cleaning up ghost bills from data arrays...');
            const cleanupResult = await cleanupGhostBills();

            // Step 3: Refresh UGRAI In Progress display
            console.log('Step 3: Refreshing UGRAI In Progress display...');
            await cleanupUgraiInProgress();

            // Step 4: Refresh UGRAI Management
            console.log('Step 4: Refreshing UGRAI Management...');
            await debugUgraiPersistence();

            console.log('✅ Full UGRAI cleanup completed!');
            console.log(`📊 Summary: Removed ${cleanupResult.removed} ghost bills out of ${cleanupResult.checked} checked`);

            return {
                ghostsFound: ghostCheck.total,
                ghostsRemoved: cleanupResult.removed,
                totalChecked: cleanupResult.checked
            };
        } else {
            console.log('✅ No ghost bills found - everything is clean!');
            return {
                ghostsFound: 0,
                ghostsRemoved: 0,
                totalChecked: ghostCheck.checked || 0
            };
        }
    } catch (error) {
        console.error('❌ Error during full UGRAI cleanup:', error);
        return {
            error: error.message,
            ghostsFound: 0,
            ghostsRemoved: 0,
            totalChecked: 0
        };
    }
};

// Database-level ghost bill cleanup
window.cleanupDatabaseGhostBills = async function () {
    if (!appState || !appState.supabaseService) {
        console.log('❌ AppState or Supabase service not available');
        return;
    }

    if (mockMode) {
        console.log('📝 Mock mode - no database cleanup needed');
        return { removed: 0, message: 'Mock mode' };
    }

    console.log('🗄️ Starting database-level ghost bill cleanup...');

    try {
        const result = await appState.supabaseService.cleanupGhostBillsFromDatabase();
        console.log('✅ Database cleanup completed:', result);

        // Refresh local data after database cleanup
        await appState.loadUgraiData();

        return result;
    } catch (error) {
        console.error('❌ Database cleanup failed:', error);
        return { error: error.message, removed: 0 };
    }
};

// Ultimate comprehensive cleanup - everything including database
window.ultimateUgraiCleanup = async function () {
    if (!appState) {
        console.log('❌ AppState not available');
        return;
    }

    console.log('🚀 Starting ULTIMATE UGRAI cleanup (local + database)...');

    try {
        // Step 1: Check current state
        console.log('Step 1: Checking current state...');
        const initialCheck = await checkForGhostBills();

        // Step 2: Clean up database first (most important)
        console.log('Step 2: Cleaning up database...');
        const dbResult = await cleanupDatabaseGhostBills();

        // Step 3: Clean up local arrays
        console.log('Step 3: Cleaning up local data...');
        const localResult = await cleanupGhostBills();

        // Step 4: Refresh all displays
        console.log('Step 4: Refreshing all displays...');
        await cleanupUgraiInProgress();
        await debugUgraiPersistence();

        // Step 5: Final verification
        console.log('Step 5: Final verification...');
        const finalCheck = await checkForGhostBills();

        console.log('🎉 ULTIMATE cleanup completed!');
        console.log('📊 Results:');
        console.log('  - Database removed:', dbResult.removed || 0);
        console.log('  - Local removed:', localResult.removed || 0);
        console.log('  - Initial ghosts:', initialCheck.total || 0);
        console.log('  - Final ghosts:', finalCheck.total || 0);

        const totalRemoved = (dbResult.removed || 0) + (localResult.removed || 0);

        if (totalRemoved > 0) {
            showToast(`Ultimate cleanup: Removed ${totalRemoved} ghost bills (${dbResult.removed || 0} from DB, ${localResult.removed || 0} local)`, 'success');
        } else {
            showToast('No ghost bills found - system is clean!', 'info');
        }

        return {
            initialGhosts: initialCheck.total || 0,
            finalGhosts: finalCheck.total || 0,
            databaseRemoved: dbResult.removed || 0,
            localRemoved: localResult.removed || 0,
            totalRemoved: totalRemoved
        };

    } catch (error) {
        console.error('❌ Ultimate cleanup failed:', error);
        showToast('Ultimate cleanup failed: ' + error.message, 'error');
        return { error: error.message };
    }
};

// Enhanced debug functions for testing UGRAI ghost bill cleanup
window.testGhostCleanup = async function () {
    console.log('🧪 Testing ghost bill cleanup...');
    try {
        const result = await appState.supabaseService.cleanupGhostBillsFromDatabase();
        console.log('Cleanup result:', result);

        // Refresh the display
        await refreshUgraiDisplay();

        console.log('✅ Ghost cleanup test completed');
        return result;
    } catch (error) {
        console.error('❌ Ghost cleanup test failed:', error);
        return { error: error.message };
    }
};

window.debugDatabaseState = async function () {
    console.log('🔍 Checking database state...');
    try {
        const result = await appState.supabaseService.debugDatabaseState();
        console.log('Database state result:', result);
        return result;
    } catch (error) {
        console.error('❌ Database state check failed:', error);
        return { error: error.message };
    }
};

window.forceCleanupTest = async function () {
    console.log('🔧 Force cleanup test with verification...');
    try {
        console.log('--- BEFORE CLEANUP ---');
        const beforeState = await debugDatabaseState();

        console.log('\n--- RUNNING CLEANUP ---');
        const result = await appState.supabaseService.cleanupGhostBillsFromDatabase();

        console.log('\n--- AFTER CLEANUP ---');
        const afterState = await debugDatabaseState();

        console.log('\n--- REFRESHING UI ---');
        await refreshUgraiDisplay();

        const summary = {
            beforeCleanup: beforeState,
            cleanupResult: result,
            afterCleanup: afterState,
            success: (beforeState.ghostsInData + beforeState.ghostsInEntries) > (afterState.ghostsInData + afterState.ghostsInEntries)
        };

        console.log('✅ Force cleanup test completed:', summary);
        return summary;
    } catch (error) {
        console.error('❌ Force cleanup test failed:', error);
        return { error: error.message };
    }
};

window.checkPersistence = async function () {
    console.log('🔄 Testing persistence after cleanup...');
    try {
        // Run cleanup
        console.log('1. Running cleanup...');
        const cleanupResult = await testGhostCleanup();

        // Wait a moment
        console.log('2. Waiting 2 seconds...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Check if ghosts are still gone
        console.log('3. Checking if ghosts persist...');
        const afterWait = await debugDatabaseState();

        // Simulate page reload by re-fetching data
        console.log('4. Simulating page reload by re-fetching all data...');
        await appState.loadInitialData();
        await refreshUgraiDisplay();

        const afterReload = await debugDatabaseState();

        const summary = {
            cleanupResult,
            afterWait,
            afterReload,
            persistenceTest: afterReload.ghostsInData === 0 && afterReload.ghostsInEntries === 0
        };

        console.log('📊 Persistence test results:', summary);

        if (summary.persistenceTest) {
            console.log('✅ Cleanup persisted successfully!');
        } else {
            console.log('❌ Cleanup did not persist - ghosts returned!');
        }

        return summary;
    } catch (error) {
        console.error('❌ Persistence test failed:', error);
        return { error: error.message };
    }
};

// New comprehensive data persistence fix
window.fixDataPersistence = async function () {
    console.log('🔧 Comprehensive data persistence fix...');
    try {
        console.log('1. 📊 Checking current data state...');
        const beforeState = await debugDatabaseState();

        console.log('2. 🧹 Running ultimate cleanup...');
        const cleanupResult = await ultimateUgraiCleanup();

        console.log('3. 💾 Forcing fresh data load from cloud...');
        await appState.loadInitialData();

        console.log('4. 🔄 Refreshing UI display...');
        await refreshUgraiDisplay();

        console.log('5. ✅ Verifying final state...');
        const afterState = await debugDatabaseState();

        const summary = {
            beforeState,
            cleanupResult,
            afterState,
            dataFixed: {
                ugraiData: afterState.ugraiData > 0,
                ugraiEntries: afterState.ugraiEntries > 0,
                ghostsRemoved: (beforeState.ghostsInData + beforeState.ghostsInEntries) > (afterState.ghostsInData + afterState.ghostsInEntries),
                persistenceWorking: afterState.ugraiData > 0 || afterState.ugraiEntries > 0
            }
        };

        console.log('📋 Data persistence fix summary:', summary);

        if (summary.dataFixed.persistenceWorking) {
            console.log('✅ Data persistence is working correctly!');
        } else {
            console.log('❌ Data persistence issue still exists - check Supabase connection');
        }

        return summary;
    } catch (error) {
        console.error('❌ Data persistence fix failed:', error);
        return { error: error.message };
    }
};

// ==============================
// ANALYSIS DASHBOARD FUNCTIONS
// ==============================

// All possible payment methods (to show even with zero values)
const ALL_PAYMENT_METHODS = ['Cash', 'Credit', 'UPI', 'Cheque', 'NEFT', 'Edited', 'Cancelled', 'Returned'];

/**
 * Fetch approved bills with optional date filtering
 */
async function fetchApprovedBills(fromDate = null, toDate = null) {
    try {
        console.log('🔍 Fetching approved bills for analysis...');

        if (!appState.supabaseService) {
            console.error('SupabaseService not available');
            return [];
        }

        // Fetch approved bills using existing service method
        let approvedBills = await appState.supabaseService.getApprovedBills() || [];

        console.log(`📊 Found ${approvedBills.length} total bills from approved_bills table`);

        // DEBUG: Count bills by status BEFORE filtering
        const statusCounts = {};
        approvedBills.forEach(bill => {
            const status = (bill.status || 'null').toLowerCase();
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        console.log('🔍 Bills by status from database:', statusCounts);

        // CRITICAL FIX: Filter to only include bills with status='approved'
        const allBills = approvedBills; // Keep original for debugging
        approvedBills = approvedBills.filter(bill => {
            const status = (bill.status || '').toLowerCase().trim();
            return status === 'approved';
        });

        console.log(`✅ After status filtering: ${approvedBills.length} bills with status='approved'`);
        console.log(`🗑️ Filtered out: ${allBills.length - approvedBills.length} bills (cancelled/returned/other)`);

        // Get retailers for sector mapping (fallback for null sectors)
        const retailers = appState.data.retailers || [];
        const retailerSectorMap = new Map();
        retailers.forEach(r => {
            if (r.name && r.sector) {
                retailerSectorMap.set(r.name.toLowerCase().trim(), r.sector);
            }
        });

        // Map sectors for bills that have null sector
        let mappedCount = 0;
        approvedBills = approvedBills.map(bill => {
            if (!bill.sector && bill.retailerName) {
                const lookupKey = bill.retailerName.toLowerCase().trim();
                const sector = retailerSectorMap.get(lookupKey);
                if (sector) {
                    mappedCount++;
                    return { ...bill, sector };
                }
            }
            return bill;
        });

        if (mappedCount > 0) {
            console.log(`✅ Mapped sectors for ${mappedCount} bills using retailer lookup`);
        }

        // Debug: Log first bill to see structure
        if (approvedBills.length > 0) {
            console.log('🔍 Sample bill structure:', approvedBills[0]);
            console.log('🔍 Available fields:', Object.keys(approvedBills[0]));
        }

        // Apply date filtering if specified
        if (fromDate || toDate) {
            approvedBills = approvedBills.filter(bill => {
                const billDate = new Date(bill.billDate || bill.bill_date || bill.createdAt || bill.created_at);
                if (fromDate && billDate < new Date(fromDate)) return false;
                if (toDate && billDate > new Date(toDate + 'T23:59:59')) return false;
                return true;
            });
            console.log(`📅 After date filtering: ${approvedBills.length} bills`);
        }

        return approvedBills;

    } catch (error) {
        console.error('❌ Error fetching approved bills:', error);
        return [];
    }
}

/**
 * Load and display supply analysis data
 */
async function loadSupplyAnalysis(fromDate = null, toDate = null) {
    try {
        console.log('📊 Loading supply analysis data using SQL aggregation...');
        showLoadingState(true);

        // Try SQL aggregation first (much faster and more accurate)
        const sqlSummary = await appState.supabaseService.getSupplyAnalysisSummary();

        if (sqlSummary && sqlSummary.length > 0) {
            console.log('✅ Using SQL aggregation results');

            // Process SQL aggregation results
            const analysisData = processSQLAggregation(sqlSummary);
            analysisData.dateRange = getDateRangeText(fromDate, toDate);

            // Fetch detailed bills to populate retailers and sectors data
            const bills = await fetchApprovedBills(fromDate, toDate);
            if (bills && bills.length > 0) {
                // Extract retailer and sector data from detailed bills
                const retailersMap = {};
                const sectorsMap = {};

                bills.forEach(bill => {
                    // Track retailers
                    if (bill.retailerName) {
                        if (!retailersMap[bill.retailerName]) {
                            retailersMap[bill.retailerName] = { count: 0, amount: 0 };
                        }
                        retailersMap[bill.retailerName].count++;
                        retailersMap[bill.retailerName].amount += parseFloat(bill.netAmount || 0);
                    }

                    // Track sectors
                    if (bill.sector) {
                        if (!sectorsMap[bill.sector]) {
                            sectorsMap[bill.sector] = { count: 0, amount: 0 };
                        }
                        sectorsMap[bill.sector].count++;
                        sectorsMap[bill.sector].amount += parseFloat(bill.netAmount || 0);
                    }
                });

                // Convert to arrays
                analysisData.retailersList = Object.entries(retailersMap).map(([name, data]) => ({
                    name,
                    count: data.count,
                    amount: data.amount
                }));

                analysisData.sectorsList = Object.entries(sectorsMap).map(([name, data]) => ({
                    name,
                    count: data.count,
                    amount: data.amount
                }));
            }

            // Update UI
            updateSupplyAnalysisUI(analysisData);

            // Create charts
            createPaymentMethodsChart(analysisData.paymentMethods);
            createSectorChart(analysisData.sectorsList);

            // Still load detailed bills for the table
            await loadDetailedBills(fromDate, toDate);

            // Load today's bills section
            if (typeof loadTodaysBills === 'function') {
                loadTodaysBills();
            }

            showLoadingState(false);
            console.log('✅ Supply analysis loaded successfully via SQL');
            return;
        }

        // Fallback to old method if SQL aggregation fails
        console.log('⚠️ SQL aggregation failed, falling back to client-side calculation...');

        // Fetch approved bills data
        const bills = await fetchApprovedBills(fromDate, toDate);

        if (!bills || bills.length === 0) {
            console.log('No approved bills data available for analysis');
            updateSupplyAnalysisUI({
                totalBills: 0,
                totalAmount: 0,
                paymentMethods: {},
                retailers: [],
                sectors: [],
                dateRange: getDateRangeText(fromDate, toDate)
            });
            showLoadingState(false);
            return;
        }

        // Calculate analysis data
        const analysisData = calculateSupplyAnalysisData(bills);
        analysisData.dateRange = getDateRangeText(fromDate, toDate);

        // Update UI
        updateSupplyAnalysisUI(analysisData);

        // Create charts
        createPaymentMethodsChart(analysisData.paymentMethods);
        createSectorChart(analysisData.sectorsList);

        // Load detailed bills (all bills, not just approved)
        await loadDetailedBills(fromDate, toDate);

        // Load today's bills section
        if (typeof loadTodaysBills === 'function') {
            loadTodaysBills();
        }

        showLoadingState(false);
        console.log('✅ Supply analysis loaded successfully');

    } catch (error) {
        console.error('❌ Error loading supply analysis:', error);
        showLoadingState(false);
    }
}

/**
 * Show/hide loading state
 */
function showLoadingState(isLoading) {
    const loadingElement = document.getElementById('analysis-loading');
    const contentElement = document.getElementById('analysis-content');

    if (loadingElement && contentElement) {
        if (isLoading) {
            loadingElement.classList.remove('hidden');
            contentElement.style.opacity = '0.5';
            contentElement.style.pointerEvents = 'none';
        } else {
            loadingElement.classList.add('hidden');
            contentElement.style.opacity = '1';
            contentElement.style.pointerEvents = 'auto';
        }
    }
}

/**
 * Process SQL aggregation results into analysis data format
 * SQL function returns: status, payment_method, total_bills, total_amount (already calculated based on business rule)
 */
function processSQLAggregation(sqlResults) {
    console.log('🔄 Processing SQL aggregation results:', sqlResults);

    const analysisData = {
        totalBills: 0,
        totalAmount: 0,
        cashAmount: 0,
        chequeAmount: 0,
        upiAmount: 0,
        creditAmount: 0,
        neftAmount: 0,
        editedAmount: 0,
        paymentMethods: {},
        statusSummary: {},
        statusPaymentDetail: {}
    };

    // Initialize all payment methods
    ALL_PAYMENT_METHODS.forEach(method => {
        analysisData.paymentMethods[method] = { count: 0, amount: 0 };
    });

    sqlResults.forEach(row => {
        const status = (row.status || 'unknown').toLowerCase();
        const paymentMethod = row.payment_method || 'NULL';
        const count = parseInt(row.total_bills || 0);
        const amount = parseFloat(row.total_amount || 0);  // Already calculated in SQL based on business rule

        // Normalize payment method name
        const normalizedMethod = paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).toLowerCase();

        // Include approved, cancelled, returned, and edited bills in total counts
        if (status === 'approved' || status === 'cancelled' || status === 'returned' || status === 'edited') {
            analysisData.totalBills += count;
            analysisData.totalAmount += amount;

            // For approved bills: add to their payment method
            // For cancelled/returned/edited: add to their respective categories
            if (status === 'approved') {
                if (!analysisData.paymentMethods[normalizedMethod]) {
                    analysisData.paymentMethods[normalizedMethod] = { count: 0, amount: 0 };
                }

                analysisData.paymentMethods[normalizedMethod].count += count;
                analysisData.paymentMethods[normalizedMethod].amount += amount;

                // Track individual payment method amounts
                if (normalizedMethod === 'Cash') {
                    analysisData.cashAmount += amount;
                } else if (normalizedMethod === 'Cheque') {
                    analysisData.chequeAmount += amount;
                } else if (normalizedMethod === 'Upi' || normalizedMethod === 'UPI') {
                    analysisData.upiAmount += amount;
                } else if (normalizedMethod === 'Credit') {
                    analysisData.creditAmount += amount;
                } else if (normalizedMethod === 'Neft' || normalizedMethod === 'NEFT') {
                    analysisData.neftAmount += amount;
                }
            } else if (status === 'cancelled') {
                // Add to "Cancelled" category
                analysisData.paymentMethods['Cancelled'].count += count;
                analysisData.paymentMethods['Cancelled'].amount += amount;
            } else if (status === 'returned') {
                // Add to "Returned" category
                analysisData.paymentMethods['Returned'].count += count;
                analysisData.paymentMethods['Returned'].amount += amount;
            } else if (status === 'edited') {
                // Add to "Edited" category
                analysisData.paymentMethods['Edited'].count += count;
                analysisData.paymentMethods['Edited'].amount += amount;
                analysisData.editedAmount += amount;
            }
        }

        // Track status summary for all bills
        const statusKey = status.charAt(0).toUpperCase() + status.slice(1);
        if (!analysisData.statusSummary[statusKey]) {
            analysisData.statusSummary[statusKey] = {
                count: 0,
                amount: 0
            };
        }
        analysisData.statusSummary[statusKey].count += count;
        analysisData.statusSummary[statusKey].amount += amount;

        // Track status × payment detail
        const detailKey = `${statusKey}|${paymentMethod}`;
        if (!analysisData.statusPaymentDetail[detailKey]) {
            analysisData.statusPaymentDetail[detailKey] = {
                status: statusKey,
                paymentMethod: paymentMethod,
                count: 0,
                amount: 0
            };
        }
        analysisData.statusPaymentDetail[detailKey].count += count;
        analysisData.statusPaymentDetail[detailKey].amount += amount;
    });

    console.log('✅ Using SQL aggregation results');
    console.log('📊 SQL-based Payment Methods:', analysisData.paymentMethods);
    console.log('💰 SQL-based Totals:', {
        totalBills: analysisData.totalBills,
        totalAmount: analysisData.totalAmount,
        cashAmount: analysisData.cashAmount,
        chequeAmount: analysisData.chequeAmount,
        upiAmount: analysisData.upiAmount,
        creditAmount: analysisData.creditAmount,
        editedAmount: analysisData.editedAmount
    });

    // Add empty arrays for retailer and sector data (will be populated by loadDetailedBills)
    analysisData.retailersList = [];
    analysisData.sectorsList = [];

    return analysisData;
}

/**
 * Get date range text for display
 */
function getDateRangeText(fromDate, toDate) {
    if (!fromDate && !toDate) return 'All time';
    if (fromDate && toDate) return `${fromDate} to ${toDate}`;
    if (fromDate) return `From ${fromDate}`;
    if (toDate) return `Up to ${toDate}`;
    return 'All time';
}

/**
 * Calculate analysis data from bills
 */
function calculateSupplyAnalysisData(bills) {
    console.log(`🧮 calculateSupplyAnalysisData: Processing ${bills.length} bills`);

    // Debug: Count bills by status
    const inputStatusCounts = {};
    bills.forEach(bill => {
        const status = (bill.status || 'null').toLowerCase();
        inputStatusCounts[status] = (inputStatusCounts[status] || 0) + 1;
    });
    console.log('📥 Input bills by status:', inputStatusCounts);

    const analysisData = {
        totalBills: 0,  // Will count only approved bills
        totalAmount: 0,
        cashAmount: 0,
        chequeAmount: 0,
        upiAmount: 0,
        creditAmount: 0,
        paymentMethods: {},
        retailers: {},
        sectors: {},
        statusSummary: {},
        statusPaymentDetail: {}
    };

    // Initialize all payment methods with zero values
    ALL_PAYMENT_METHODS.forEach(method => {
        analysisData.paymentMethods[method] = {
            count: 0,
            amount: 0
        };
    });

    // Debug: Track bills by status and payment method
    const debugCounts = {};
    const debugAmounts = {};  // Track amounts by payment method
    let skippedCount = 0;
    let processedCount = 0;

    bills.forEach(bill => {
        // Get bill status
        const billStatus = (bill.status || '').toString().trim().toLowerCase();

        // Debug: Log any bills with unexpected status values
        if (billStatus !== 'approved' && billStatus !== 'cancelled' && billStatus !== 'returned' && billStatus !== 'delivered') {
            console.warn('⚠️ Unexpected bill status:', billStatus, 'for bill:', bill.billNumber, 'Raw status:', bill.status);
        }

        // ONLY process approved bills for payment method analysis
        if (billStatus !== 'approved') {
            skippedCount++;

            // Still track status summary for all bills
            const statusKey = billStatus.charAt(0).toUpperCase() + billStatus.slice(1);

            if (!analysisData.statusSummary[statusKey]) {
                analysisData.statusSummary[statusKey] = {
                    count: 0,
                    netAmount: 0,
                    receivedAmount: 0
                };
            }
            analysisData.statusSummary[statusKey].count++;
            analysisData.statusSummary[statusKey].netAmount += parseFloat(bill.netAmount || bill.net_amount || bill.amount || 0);
            analysisData.statusSummary[statusKey].receivedAmount += parseFloat(bill.receivedAmount || bill.received_amount || 0);

            return; // Skip non-approved bills for payment analysis
        }

        processedCount++;

        // Get payment method
        let paymentMethod = (bill.paymentMethod || bill.payment_method || bill.deliveryMethod || '').toString().trim();

        // Track bills with empty/null payment method
        if (!paymentMethod) {
            console.warn('⚠️ EMPTY payment_method for approved bill:', bill.billNumber,
                'NetAmount:', bill.netAmount, 'ReceivedAmount:', bill.receivedAmount);
        }

        // Calculate amount for this bill
        let amount = 0;
        if (paymentMethod.toLowerCase() === 'credit') {
            // For credit bills, use net_amount
            amount = parseFloat(bill.netAmount || bill.net_amount || bill.amount || 0);
        } else {
            // For non-credit bills, ONLY use received_amount (never net_amount)
            amount = parseFloat(bill.receivedAmount || bill.received_amount || 0);
        }

        // Debug: Log first 3 bills of each payment method to see the data
        const normalizedMethod = paymentMethod.toLowerCase();
        if (!debugAmounts[normalizedMethod]) {
            debugAmounts[normalizedMethod] = {
                count: 0,
                totalAmount: 0,
                samples: []
            };
        }
        if (debugAmounts[normalizedMethod].samples.length < 3) {
            debugAmounts[normalizedMethod].samples.push({
                billNumber: bill.billNumber,
                paymentMethod: bill.paymentMethod,
                netAmount: bill.netAmount,
                receivedAmount: bill.receivedAmount,
                calculatedAmount: amount
            });
        }
        debugAmounts[normalizedMethod].count++;
        debugAmounts[normalizedMethod].totalAmount += amount;

        // Add to total revenue (only approved bills reach here)
        const netAmount = parseFloat(bill.netAmount || bill.net_amount || bill.amount || 0);
        analysisData.totalAmount += netAmount;
        analysisData.totalBills++;

        // Normalize payment method names
        const paymentMapping = {
            'cash': 'Cash',
            'credit': 'Credit',
            'upi': 'UPI',
            'upi payment': 'UPI',
            'upi transfer': 'UPI',
            'cheque': 'Cheque',
            'neft': 'NEFT',
            'rtgs': 'NEFT',
            'bank transfer': 'NEFT',
            'bank_transfer': 'NEFT',
            'direct': 'Cash',
            'courier': 'Cash',
            'self': 'Cash'
        };

        const categoryMethod = paymentMapping[paymentMethod.toLowerCase()] || 'Cash';

        // Debug: Log if payment method was mapped or defaulted
        const originalMethod = paymentMethod.toLowerCase();
        const wasMapped = paymentMapping[originalMethod] !== undefined;
        const wasDefaulted = !wasMapped;

        if (wasDefaulted && paymentMethod) {
            console.warn(`⚠️ UNMAPPED payment_method defaulted to Cash: "${paymentMethod}" for bill:`, bill.billNumber);
        }

        if (wasMapped && paymentMapping[originalMethod] === 'Cash' && originalMethod !== 'cash') {
            console.log(`🔄 Mapped to Cash: "${paymentMethod}" → Cash for bill:`, bill.billNumber);
        }

        // Ensure the category exists in our data structure
        if (!analysisData.paymentMethods[categoryMethod]) {
            analysisData.paymentMethods[categoryMethod] = { count: 0, amount: 0 };
        }

        analysisData.paymentMethods[categoryMethod].count++;
        analysisData.paymentMethods[categoryMethod].amount += amount;

        // Track specific payment method amounts (only approved bills)
        if (categoryMethod === 'Cash') {
            analysisData.cashAmount += amount;
        } else if (categoryMethod === 'Cheque') {
            analysisData.chequeAmount += amount;
        } else if (categoryMethod === 'UPI') {
            analysisData.upiAmount += amount;
        } else if (categoryMethod === 'Credit') {
            analysisData.creditAmount += amount;
        }

        // Track status summary (only approved bills reach here now)
        const statusKey = 'Approved';

        if (!analysisData.statusSummary[statusKey]) {
            analysisData.statusSummary[statusKey] = {
                count: 0,
                netAmount: 0,
                receivedAmount: 0
            };
        }
        analysisData.statusSummary[statusKey].count++;
        analysisData.statusSummary[statusKey].netAmount += netAmount;
        analysisData.statusSummary[statusKey].receivedAmount += parseFloat(bill.receivedAmount || bill.received_amount || 0);

        // Track status × payment method detail (only approved bills)
        const statusPaymentKey = `${statusKey}|${categoryMethod}`;
        if (!analysisData.statusPaymentDetail[statusPaymentKey]) {
            analysisData.statusPaymentDetail[statusPaymentKey] = {
                status: statusKey,
                paymentMethod: categoryMethod,
                count: 0,
                netAmount: 0,
                receivedAmount: 0
            };
        }
        analysisData.statusPaymentDetail[statusPaymentKey].count++;
        analysisData.statusPaymentDetail[statusPaymentKey].netAmount += netAmount;
        analysisData.statusPaymentDetail[statusPaymentKey].receivedAmount += parseFloat(bill.receivedAmount || bill.received_amount || 0);

        // Retailers - try multiple possible field names (only approved bills)
        const retailer = bill.retailerName || bill.retailer_name || bill.retailer || 'Unknown';
        if (!analysisData.retailers[retailer]) {
            analysisData.retailers[retailer] = {
                count: 0,
                amount: 0,
                sector: bill.sector || 'Unknown'
            };
        }
        analysisData.retailers[retailer].count++;
        analysisData.retailers[retailer].amount += amount;

        // Sectors (only approved bills)
        const sector = bill.sector || 'Unknown';
        if (!analysisData.sectors[sector]) {
            analysisData.sectors[sector] = {
                count: 0,
                amount: 0,
                retailers: new Set()
            };
        }
        analysisData.sectors[sector].count++;
        analysisData.sectors[sector].amount += amount;
        analysisData.sectors[sector].retailers.add(retailer);

        // Debug: Track status × payment categorization (only approved bills)
        const debugKey = `approved|${categoryMethod}`;
        if (!debugCounts[debugKey]) {
            debugCounts[debugKey] = 0;
        }
        debugCounts[debugKey]++;
    });

    // CRITICAL DIAGNOSTIC: Count bills by ACTUAL database payment_method value
    const rawPaymentMethodCounts = {};
    bills.forEach(bill => {
        const billStatus = (bill.status || '').toString().trim().toLowerCase();
        if (billStatus === 'approved') {
            const rawMethod = bill.paymentMethod || bill.payment_method || 'NULL';
            rawPaymentMethodCounts[rawMethod] = (rawPaymentMethodCounts[rawMethod] || 0) + 1;
        }
    });

    console.log('\n🔬 DIAGNOSTIC - Raw payment_method values from database (approved bills only):');
    Object.entries(rawPaymentMethodCounts).sort((a, b) => b[1] - a[1]).forEach(([method, count]) => {
        console.log(`  "${method}": ${count} bills`);
    });

    console.log('\n🔬 EXPECTED from your SQL query:');
    console.log('  "Cash": 301 bills');
    console.log('  "Cheque": 40 bills');
    console.log('  "Credit": 4136 bills');
    console.log('  "UPI": 10 bills');
    console.log('  TOTAL: 4487 bills');

    // Debug: Log the actual categorization
    console.log(`\n🔍 Processed ${processedCount} approved bills, skipped ${skippedCount} non-approved bills`);
    console.log('🔍 Debug - Bills categorized by status|categoryMethod:');
    Object.entries(debugCounts).sort().forEach(([key, count]) => {
        console.log(`  ${key}: ${count} bills`);
    });

    // Debug: Log sample bills by payment method with amounts
    console.log('\n💰 Sample bills by payment method (first 3 of each):');
    Object.entries(debugAmounts).forEach(([method, data]) => {
        console.log(`\n${method.toUpperCase()} (${data.count} bills, total: ₹${data.totalAmount.toFixed(2)}):`);
        data.samples.forEach(sample => {
            console.log(`  Bill: ${sample.billNumber}`);
            console.log(`    Payment Method: ${sample.paymentMethod}`);
            console.log(`    Net Amount: ₹${sample.netAmount}`);
            console.log(`    Received Amount: ₹${sample.receivedAmount}`);
            console.log(`    ✓ Used Amount: ₹${sample.calculatedAmount}`);
        });
    });

    // Convert to arrays and sort
    analysisData.retailersList = Object.entries(analysisData.retailers)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.amount - a.amount);

    analysisData.sectorsList = Object.entries(analysisData.sectors)
        .map(([name, data]) => ({
            name,
            count: data.count,
            amount: data.amount,
            retailerCount: data.retailers.size
        }))
        .sort((a, b) => b.amount - a.amount);

    // Debug: Log payment methods breakdown
    console.log('📊 Payment Methods Analysis:', JSON.stringify(analysisData.paymentMethods, null, 2));
    console.log('🚫 Cancelled bills count:', analysisData.paymentMethods['Cancelled']?.count || 0);

    return analysisData;
}

/**
 * Update the supply analysis UI with data
 */
function updateSupplyAnalysisUI(data) {
    // Update cards
    const totalBillsElement = document.getElementById('supply-total-bills-count');
    const totalAmountElement = document.getElementById('supply-total-amount');
    const dateRangeElement = document.getElementById('analysis-date-range');

    // Payment method amount elements
    const cashAmountElement = document.getElementById('supply-cash-amount');
    const chequeAmountElement = document.getElementById('supply-cheque-amount');
    const upiAmountElement = document.getElementById('supply-upi-amount');
    const creditAmountElement = document.getElementById('supply-credit-amount');
    const editedAmountElement = document.getElementById('supply-edited-amount');

    if (totalBillsElement) {
        totalBillsElement.textContent = data.totalBills.toLocaleString();
    }

    if (totalAmountElement) {
        totalAmountElement.textContent = `₹${data.totalAmount.toLocaleString()}`;
    }

    if (dateRangeElement) {
        dateRangeElement.textContent = data.dateRange || 'All approved supply bills';
    }

    // Update payment method amounts
    if (cashAmountElement) {
        cashAmountElement.textContent = `₹${(data.cashAmount || 0).toLocaleString()}`;
    }

    if (chequeAmountElement) {
        chequeAmountElement.textContent = `₹${(data.chequeAmount || 0).toLocaleString()}`;
    }

    if (upiAmountElement) {
        upiAmountElement.textContent = `₹${(data.upiAmount || 0).toLocaleString()}`;
    }

    if (creditAmountElement) {
        creditAmountElement.textContent = `₹${(data.creditAmount || 0).toLocaleString()}`;
    }

    if (editedAmountElement) {
        editedAmountElement.textContent = `₹${(data.editedAmount || 0).toLocaleString()}`;
    }

    // Update retailer tables
    updateRetailerTables(data.retailersList);

    // Update sector table
    updateSectorTable(data.sectorsList);

    // Update status breakdown tables
    updateStatusTables(data.statusSummary, data.statusPaymentDetail);
}

/**
 * Update status breakdown tables
 */
function updateStatusTables(statusSummary, statusPaymentDetail) {
    // Update status summary table
    const statusSummaryTable = document.getElementById('status-summary-table');
    if (statusSummaryTable && statusSummary) {
        const statusRows = Object.entries(statusSummary)
            .sort((a, b) => a[0].localeCompare(b[0])) // Sort by status name
            .map(([status, stats]) => `
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="p-2 text-gray-800 font-medium">${status}</td>
                    <td class="p-2 text-right font-semibold text-blue-600">${stats.count}</td>
                    <td class="p-2 text-right text-gray-600">₹${Number(stats.amount || stats.netAmount || 0).toFixed(2)}</td>
                    <td class="p-2 text-right text-gray-600">₹${Number(stats.amount || stats.receivedAmount || 0).toFixed(2)}</td>
                </tr>
            `).join('');

        statusSummaryTable.innerHTML = statusRows || '<tr><td colspan="4" class="p-4 text-center text-gray-500">No data available</td></tr>';
    }

    // Update status × payment method detail table
    const statusPaymentDetailTable = document.getElementById('status-payment-detail-table');
    if (statusPaymentDetailTable && statusPaymentDetail) {
        const detailRows = Object.values(statusPaymentDetail)
            .sort((a, b) => {
                // Sort by status first, then by payment method
                if (a.status !== b.status) {
                    return a.status.localeCompare(b.status);
                }
                return a.paymentMethod.localeCompare(b.paymentMethod);
            })
            .map(detail => `
                <tr class="border-b border-gray-100 hover:bg-gray-50">
                    <td class="p-2 text-gray-800">${detail.status}</td>
                    <td class="p-2 text-gray-800">${detail.paymentMethod}</td>
                    <td class="p-2 text-right font-semibold text-blue-600">${detail.count}</td>
                    <td class="p-2 text-right text-gray-600">₹${Number(detail.amount || detail.netAmount || 0).toFixed(2)}</td>
                    <td class="p-2 text-right text-gray-600">₹${Number(detail.amount || detail.receivedAmount || 0).toFixed(2)}</td>
                </tr>
            `).join('');

        statusPaymentDetailTable.innerHTML = detailRows || '<tr><td colspan="5" class="p-4 text-center text-gray-500">No data available</td></tr>';
    }
}

/**
 * Update retailer analysis tables
 */
let retailerAnalysisData = [];
let retailerBillsSortState = { column: 'bills', direction: 'desc' };
let retailerAmountSortState = { column: 'amount', direction: 'desc' };

function updateRetailerTables(retailers) {
    // Store retailers data for sorting
    retailerAnalysisData = retailers || [];

    // Render both tables
    renderRetailerBillsTable();
    renderRetailerAmountTable();

    // Add click handlers to both tables
    setupRetailerTableSorting();
}

function setupRetailerTableSorting() {
    // Get all sortable headers
    const allHeaders = document.querySelectorAll('th.sortable[data-table]');

    allHeaders.forEach(header => {
        // Remove existing listeners by cloning
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);

        newHeader.addEventListener('click', () => {
            const column = newHeader.dataset.column;
            const table = newHeader.dataset.table;

            if (table === 'bills') {
                // Toggle direction if same column, otherwise default to desc
                if (retailerBillsSortState.column === column) {
                    retailerBillsSortState.direction = retailerBillsSortState.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    retailerBillsSortState.column = column;
                    retailerBillsSortState.direction = 'desc';
                }
                renderRetailerBillsTable();
            } else if (table === 'amount') {
                // Toggle direction if same column, otherwise default to desc
                if (retailerAmountSortState.column === column) {
                    retailerAmountSortState.direction = retailerAmountSortState.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    retailerAmountSortState.column = column;
                    retailerAmountSortState.direction = 'desc';
                }
                renderRetailerAmountTable();
            }

            // Re-setup handlers after re-render
            setupRetailerTableSorting();
        });
    });
}

function renderRetailerBillsTable() {
    const billsTable = document.getElementById('retailer-bills-table');
    if (!billsTable) return;

    // Sort the data
    const sortedRetailers = [...retailerAnalysisData].sort((a, b) => {
        let aVal, bVal;

        switch (retailerBillsSortState.column) {
            case 'retailer':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                return retailerBillsSortState.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            case 'bills':
                aVal = Number(a.count) || 0;
                bVal = Number(b.count) || 0;
                break;
            case 'amount':
                aVal = Number(a.amount) || 0;
                bVal = Number(b.amount) || 0;
                break;
            default:
                return 0;
        }

        return retailerBillsSortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    billsTable.innerHTML = sortedRetailers.map(retailer => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="p-2 text-gray-800">${retailer.name}</td>
            <td class="p-2 text-right font-semibold text-blue-600">${retailer.count}</td>
            <td class="p-2 text-right text-gray-600">₹${Number(retailer.amount).toFixed(2)}</td>
        </tr>
    `).join('') || '<tr><td colspan="3" class="p-4 text-center text-gray-500">No data available</td></tr>';
}

function renderRetailerAmountTable() {
    const amountTable = document.getElementById('retailer-amount-table');
    if (!amountTable) return;

    // Sort the data
    const sortedRetailers = [...retailerAnalysisData].sort((a, b) => {
        let aVal, bVal;

        switch (retailerAmountSortState.column) {
            case 'retailer':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                return retailerAmountSortState.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            case 'amount':
                aVal = Number(a.amount) || 0;
                bVal = Number(b.amount) || 0;
                break;
            case 'bills':
                aVal = Number(a.count) || 0;
                bVal = Number(b.count) || 0;
                break;
            default:
                return 0;
        }

        return retailerAmountSortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    amountTable.innerHTML = sortedRetailers.map(retailer => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="p-2 text-gray-800">${retailer.name}</td>
            <td class="p-2 text-right font-semibold text-green-600">₹${Number(retailer.amount).toFixed(2)}</td>
            <td class="p-2 text-right text-gray-600">${retailer.count}</td>
        </tr>
    `).join('') || '<tr><td colspan="3" class="p-4 text-center text-gray-500">No data available</td></tr>';
}

/**
 * Update sector analysis table
 */
let sectorAnalysisData = [];
let sectorSortState = { column: 'amount', direction: 'desc' };

function updateSectorTable(sectors) {
    // Store sectors data for sorting
    sectorAnalysisData = sectors || [];

    // Render the table
    renderSectorTable();

    // Add click handlers to sortable headers
    const sectorTableHeaders = document.querySelectorAll('#sector-analysis-table').length > 0
        ? document.querySelectorAll('#sector-analysis-table').item(0).closest('table')?.querySelectorAll('th.sortable')
        : null;

    if (sectorTableHeaders) {
        sectorTableHeaders.forEach(header => {
            // Remove existing listeners by cloning
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);

            newHeader.addEventListener('click', () => {
                const column = newHeader.dataset.column;

                // Toggle direction if same column, otherwise default to desc
                if (sectorSortState.column === column) {
                    sectorSortState.direction = sectorSortState.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    sectorSortState.column = column;
                    sectorSortState.direction = 'desc';
                }

                renderSectorTable();
            });
        });
    }
}

function renderSectorTable() {
    const sectorTable = document.getElementById('sector-analysis-table');
    if (!sectorTable) return;

    // Sort the data
    const sortedSectors = [...sectorAnalysisData].sort((a, b) => {
        let aVal, bVal;

        switch (sectorSortState.column) {
            case 'sector':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                return sectorSortState.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            case 'bills':
                aVal = Number(a.count) || 0;
                bVal = Number(b.count) || 0;
                break;
            case 'amount':
                // Ensure we parse the amount as a number
                aVal = Number(a.amount) || 0;
                bVal = Number(b.amount) || 0;
                break;
            default:
                return 0;
        }

        return sectorSortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Render the sorted data
    sectorTable.innerHTML = sortedSectors.map(sector => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="p-2 text-gray-800">${sector.name}</td>
            <td class="p-2 text-right font-semibold text-purple-600">${sector.count}</td>
            <td class="p-2 text-right text-gray-600">₹${Number(sector.amount).toFixed(2)}</td>
        </tr>
    `).join('') || '<tr><td colspan="3" class="p-4 text-center text-gray-500">No data available</td></tr>';
}

/**
 * Create payment methods bar chart (shows all methods including zeros)
 */
function createPaymentMethodsChart(paymentMethods) {
    const canvas = document.getElementById('supply-payment-methods-chart');
    if (!canvas) return;

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    // Use all payment methods to ensure consistency
    const labels = ALL_PAYMENT_METHODS;
    const data = labels.map(method => paymentMethods[method]?.count || 0);
    const amounts = labels.map(method => paymentMethods[method]?.amount || 0);

    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Number of Bills',
                data: data,
                backgroundColor: [
                    'rgba(59, 130, 246, 0.7)',  // Blue
                    'rgba(16, 185, 129, 0.7)',  // Green
                    'rgba(245, 158, 11, 0.7)',  // Yellow
                    'rgba(239, 68, 68, 0.7)',   // Red
                    'rgba(139, 92, 246, 0.7)',  // Purple
                    'rgba(6, 182, 212, 0.7)',   // Cyan
                    'rgba(236, 72, 153, 0.7)',  // Pink
                    'rgba(34, 197, 94, 0.7)',   // Emerald
                ],
                borderColor: [
                    'rgba(59, 130, 246, 1)',
                    'rgba(16, 185, 129, 1)',
                    'rgba(245, 158, 11, 1)',
                    'rgba(239, 68, 68, 1)',
                    'rgba(139, 92, 246, 1)',
                    'rgba(6, 182, 212, 1)',
                    'rgba(236, 72, 153, 1)',
                    'rgba(34, 197, 94, 1)',
                ],
                borderWidth: 2,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        afterLabel: function (context) {
                            const paymentMethod = labels[context.dataIndex];
                            const amount = amounts[context.dataIndex];
                            return `Amount: ₹${amount.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Number of Bills'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Payment Method'
                    }
                }
            }
        }
    });
}

/**
 * Create sector analysis doughnut chart
 */
function createSectorChart(sectors) {
    const canvas = document.getElementById('supply-sector-chart');
    if (!canvas) return;

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    if (sectors.length === 0) {
        // Show "No data" message
        ctx.font = '16px Arial';
        ctx.fillStyle = '#6B7280';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        return;
    }

    const labels = sectors.map(s => s.name);
    const data = sectors.map(s => s.amount);

    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgba(59, 130, 246, 0.8)',  // Blue
                    'rgba(16, 185, 129, 0.8)',  // Green
                    'rgba(245, 158, 11, 0.8)',  // Yellow
                    'rgba(239, 68, 68, 0.8)',   // Red
                    'rgba(139, 92, 246, 0.8)',  // Purple
                    'rgba(6, 182, 212, 0.8)',   // Cyan
                    'rgba(236, 72, 153, 0.8)',  // Pink
                    'rgba(34, 197, 94, 0.8)',   // Emerald
                ],
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const sector = sectors[context.dataIndex];
                            const total = sectors.reduce((sum, s) => sum + s.amount, 0);
                            const percentage = total > 0 ? ((sector.amount / total) * 100).toFixed(1) : 0;
                            return [
                                `${sector.name}: ₹${sector.amount.toLocaleString()}`,
                                `${percentage}% of total amount`,
                                `${sector.count} bills`
                            ];
                        }
                    }
                }
            }
        }
    });
}

/**
 * Handle date range selection
 */
function handleDateRangeSelection() {
    const quickDateSelect = document.getElementById('analysis-quick-date');
    const fromDateInput = document.getElementById('analysis-from-date');
    const toDateInput = document.getElementById('analysis-to-date');

    if (!quickDateSelect || !fromDateInput || !toDateInput) return;

    const today = new Date();
    const value = quickDateSelect.value;

    let fromDate = null;
    let toDate = null;

    switch (value) {
        case 'today':
            fromDate = toDate = today.toISOString().split('T')[0];
            break;
        case 'week':
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            fromDate = weekStart.toISOString().split('T')[0];
            toDate = today.toISOString().split('T')[0];
            break;
        case 'month':
            fromDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
            toDate = today.toISOString().split('T')[0];
            break;
        case 'quarter':
            const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
            fromDate = quarterStart.toISOString().split('T')[0];
            toDate = today.toISOString().split('T')[0];
            break;
        case 'year':
            fromDate = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
            toDate = today.toISOString().split('T')[0];
            break;
        case 'all':
            fromDate = toDate = null;
            break;
        default:
            // Custom range - don't change the date inputs
            return;
    }

    fromDateInput.value = fromDate || '';
    toDateInput.value = toDate || '';
}

// Initialize supply analysis when the tab is clicked
document.addEventListener('DOMContentLoaded', function () {
    // Set default dates
    const today = new Date().toISOString().split('T')[0];
    const toDateInput = document.getElementById('analysis-to-date');
    if (toDateInput) {
        toDateInput.value = today;
    }

    // Set default dates for ugrai analysis
    const ugraiToDateInput = document.getElementById('ugrai-analysis-to-date');
    if (ugraiToDateInput) {
        ugraiToDateInput.value = today;
    }

    // Listen for supply analysis tab clicks
    document.addEventListener('click', function (e) {
        if (e.target.dataset && e.target.dataset.tabId === 'supply-analysis') {
            setTimeout(() => {
                loadSupplyAnalysis(); // Load all time data initially
            }, 100);
        }

        // Listen for payment received analysis tab clicks
        if (e.target.dataset && e.target.dataset.tabId === 'payment-received-analysis') {
            setTimeout(() => {
                loadUgraiAnalysis(); // Load all time data initially
            }, 100);
        }

        // Listen for purchase analysis tab clicks
        if (e.target.dataset && e.target.dataset.tabId === 'purchase-analysis') {
            setTimeout(() => {
                loadPurchaseAnalysis(); // Load all time data initially
            }, 100);
        }

        // Listen for pending bills analysis tab clicks
        if (e.target.dataset && e.target.dataset.tabId === 'pending-bills') {
            setTimeout(() => {
                loadPendingBillsAnalysis(); // Load pending bills data initially
            }, 100);
        }
    });

    // Date range quick select for supply analysis
    const quickDateSelect = document.getElementById('analysis-quick-date');
    if (quickDateSelect) {
        quickDateSelect.addEventListener('change', handleDateRangeSelection);
    }

    // Date range quick select for ugrai analysis
    const ugraiQuickDateSelect = document.getElementById('ugrai-analysis-quick-date');
    if (ugraiQuickDateSelect) {
        ugraiQuickDateSelect.addEventListener('change', handleUgraiDateRangeSelection);
    }

    // Apply filter button for supply analysis
    const applyFilterBtn = document.getElementById('apply-date-filter');
    if (applyFilterBtn) {
        applyFilterBtn.addEventListener('click', function () {
            const fromDate = document.getElementById('analysis-from-date')?.value || null;
            const toDate = document.getElementById('analysis-to-date')?.value || null;
            loadSupplyAnalysis(fromDate, toDate);
        });
    }

    // Apply filter button for ugrai analysis
    const applyUgraiFilterBtn = document.getElementById('apply-ugrai-date-filter');
    if (applyUgraiFilterBtn) {
        applyUgraiFilterBtn.addEventListener('click', function () {
            const fromDate = document.getElementById('ugrai-analysis-from-date')?.value || null;
            const toDate = document.getElementById('ugrai-analysis-to-date')?.value || null;
            loadUgraiAnalysis(fromDate, toDate);
        });
    }

    // Backfill sectors button for supply analysis
    const backfillSectorsBtn = document.getElementById('backfill-sectors-btn');
    if (backfillSectorsBtn) {
        backfillSectorsBtn.addEventListener('click', async function () {
            if (!confirm('This will update all bills and supplies with missing or unknown sectors by looking up sectors from the retailers table. Continue?')) {
                return;
            }

            this.disabled = true;
            this.innerHTML = '<span>⏳</span><span>Processing...</span>';

            try {
                const result = await appState.supabaseService.backfillApprovedBillsSectors();
                showToast(`✅ Updated ${result.updated} bills and supplies. ${result.notFound} retailers not found in database.`, 'success', 5000);

                // Clear cached data to force fresh fetch from database
                console.log('🔄 Clearing cached data to fetch fresh sectors...');
                appState.data.approvedBills = null;
                appState.data.activeSupplies = null;
                appState.data.suppliesForApproval = null;
                appState.data.ugraiData = null;
                appState.data.ugraiEntries = null;
                appState.data.availableUgraiData = null;

                // Reload analysis to show updated data
                const fromDate = document.getElementById('analysis-from-date')?.value || null;
                const toDate = document.getElementById('analysis-to-date')?.value || null;
                await loadSupplyAnalysis(fromDate, toDate);
            } catch (error) {
                console.error('Error backfilling sectors:', error);
                showToast('❌ Error updating sectors: ' + error.message, 'error');
            } finally {
                this.disabled = false;
                this.innerHTML = '<span>🔧</span><span>Fix Sectors</span>';
            }
        });
    }

    // Refresh button for supply analysis
    const refreshBtn = document.getElementById('refresh-analysis-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            const fromDate = document.getElementById('analysis-from-date')?.value || null;
            const toDate = document.getElementById('analysis-to-date')?.value || null;
            loadSupplyAnalysis(fromDate, toDate);
        });
    }

    // Refresh button for ugrai analysis
    const refreshUgraiBtn = document.getElementById('refresh-ugrai-analysis-btn');
    if (refreshUgraiBtn) {
        refreshUgraiBtn.addEventListener('click', function () {
            const fromDate = document.getElementById('ugrai-analysis-from-date')?.value || null;
            const toDate = document.getElementById('ugrai-analysis-to-date')?.value || null;
            loadUgraiAnalysis(fromDate, toDate);
        });
    }

    // Refresh button for pending bills analysis
    const refreshPendingBillsBtn = document.getElementById('refresh-pending-bills-btn');
    if (refreshPendingBillsBtn) {
        refreshPendingBillsBtn.addEventListener('click', function () {
            loadPendingBillsAnalysis();
        });
    }

    // Purchase Analysis Event Listeners
    const purchaseQuickDateSelect = document.getElementById('purchase-analysis-quick-date');
    if (purchaseQuickDateSelect) {
        purchaseQuickDateSelect.addEventListener('change', handlePurchaseDateRangeSelection);
    }

    const applyPurchaseFilterBtn = document.getElementById('apply-purchase-analysis-filter');
    if (applyPurchaseFilterBtn) {
        applyPurchaseFilterBtn.addEventListener('click', function () {
            const fromDate = document.getElementById('purchase-analysis-from-date')?.value || null;
            const toDate = document.getElementById('purchase-analysis-to-date')?.value || null;
            loadPurchaseAnalysis(fromDate, toDate);
        });
    }

    const refreshPurchaseBtn = document.getElementById('refresh-purchase-analysis-btn');
    if (refreshPurchaseBtn) {
        refreshPurchaseBtn.addEventListener('click', function () {
            const fromDate = document.getElementById('purchase-analysis-from-date')?.value || null;
            const toDate = document.getElementById('purchase-analysis-to-date')?.value || null;
            loadPurchaseAnalysis(fromDate, toDate);
        });
    }

    // Purchase debug toggle
    const togglePurchaseDebugBtn = document.getElementById('toggle-purchase-debug');
    if (togglePurchaseDebugBtn) {
        togglePurchaseDebugBtn.addEventListener('click', function () {
            const debugContent = document.getElementById('purchase-debug-content');
            if (debugContent) {
                const isHidden = debugContent.classList.contains('hidden');
                if (isHidden) {
                    debugContent.classList.remove('hidden');
                    this.textContent = 'Hide Data';
                } else {
                    debugContent.classList.add('hidden');
                    this.textContent = 'Show Data';
                }
            }
        });
    }
});

// ==============================
// DEBUG AND TEST FUNCTIONS
// ==============================

/**
 * Debug function to test ugrai data availability
 */
async function debugUgraiData() {
    console.log('🔍 DEBUG: Testing ugrai data availability...');

    if (!appState.supabaseService) {
        console.error('❌ SupabaseService not available');
        return;
    }

    try {
        // Test completed_ugrai table
        console.log('📊 Testing completed_ugrai table...');
        const completedUgrai = await appState.supabaseService.getCompletedUgrai();
        console.log(`📊 completed_ugrai results:`, completedUgrai);
        console.log(`📊 completed_ugrai count: ${completedUgrai ? completedUgrai.length : 0}`);

        // Test ugrai_completed table  
        console.log('📊 Testing ugrai_completed table...');
        const completedUgraiNew = await appState.supabaseService.getCompletedUgraiNew();
        console.log(`📊 ugrai_completed results:`, completedUgraiNew);
        console.log(`📊 ugrai_completed count: ${completedUgraiNew ? completedUgraiNew.length : 0}`);

        // Test if we have any ugrai data at all
        const allUgrai = await appState.supabaseService.getAllUgrai();
        console.log(`📊 all ugrai count: ${allUgrai ? allUgrai.length : 0}`);

        return {
            completedUgrai: completedUgrai || [],
            completedUgraiNew: completedUgraiNew || [],
            allUgrai: allUgrai || []
        };

    } catch (error) {
        console.error('❌ Error in debug test:', error);
        return null;
    }
}

// Make debug function available globally for console testing
window.debugUgraiData = debugUgraiData;

// Debug function for delivery person login issues
window.debugDeliveryPerson = function () {
    console.log('🚚 DELIVERY PERSON DEBUG:');
    console.log('========================');
    console.log('👤 User ID:', appState?.supabaseService?.userId || 'N/A');
    console.log('👔 User Role:', appState?.userRole || 'undefined (❌ PROBLEM!)');
    console.log('📊 Ugrai In Progress count:', appState?.data?.ugraiInProgress?.length || 0);
    console.log('📋 All Ugrai Data count:', appState?.data?.ugraiData?.length || 0);

    if (appState?.data?.ugraiInProgress && appState.data.ugraiInProgress.length > 0) {
        console.log('📦 First 3 bills in progress:');
        appState.data.ugraiInProgress.slice(0, 3).forEach((bill, idx) => {
            console.log(`  ${idx + 1}.`, {
                billNumber: bill.billNumber,
                retailer: bill.retailerName,
                sector: bill.sector,
                amount: bill.netAmount,
                assignedTo: bill.assignedTo,
                assignedDate: bill.assignedDate
            });
        });
    } else {
        console.log('❌ No bills in ugraiInProgress!');
        if (!appState?.userRole) {
            console.log('💡 Likely cause: userRole is not set');
            console.log('💡 Fix: User role needs to be loaded from database');
        }
    }

    console.log('========================');
};

// Debug helper to check ugrai assignments
window.debugUgraiAssignments = async function () {
    console.log('🔍 UGRAI ASSIGNMENTS DEBUG:');
    console.log('========================');

    if (!appState?.supabaseService) {
        console.error('❌ SupabaseService not available');
        return;
    }

    const userId = appState.supabaseService.userId;
    console.log('👤 Current User ID:', userId);

    // Get supabase client
    const supabaseClient = window.supabase?.createClient(
        'dls-sheets-backend',
        'not-needed',
        {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storage: window.localStorage,
                flowType: 'pkce'
            }
        }
    );

    if (!supabaseClient) {
        console.error('❌ Could not create Supabase client');
        return;
    }

    // Get user profile
    const { data: profileData, error: profileError } = await supabaseClient
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId);

    console.log('📋 User Profile:', profileData);
    console.log('📋 Full Name (raw):', JSON.stringify(profileData?.[0]?.full_name));
    console.log('❌ Profile Error:', profileError);

    const userName = profileData?.[0]?.full_name;

    // Check assignments for this user
    const { data: userAssignments, error: userError } = await supabaseClient
        .from('ugrai_assignments')
        .select('*')
        .eq('assigned_to', userName);

    console.log(`📋 Assignments WHERE assigned_to = "${userName}":`, userAssignments);
    console.log('❌ Error:', userError);

    // Check ALL assignments in the table
    const { data: allAssignments, error: allError } = await supabaseClient
        .from('ugrai_assignments')
        .select('*')
        .limit(20);

    console.log('📊 Sample of ALL assignments in table:', allAssignments);
    console.log('❌ Error:', allError);

    // Check if there are assignments with "manoj" (case-insensitive)
    const { data: manojAssignments, error: manojError } = await supabaseClient
        .from('ugrai_assignments')
        .select('*')
        .ilike('assigned_to', '%manoj%');

    console.log('👤 Assignments matching "manoj" (case-insensitive):', manojAssignments);
    console.log('❌ Error:', manojError);

    // Compare names
    if (allAssignments && allAssignments.length > 0) {
        console.log('\n🔍 Name Comparison:');
        allAssignments.forEach(a => {
            const match = a.assigned_to === userName;
            const rawMatch = JSON.stringify(a.assigned_to) === JSON.stringify(userName);
            console.log(`  "${a.assigned_to}" === "${userName}": ${match} (raw: ${rawMatch})`);
        });
    }

    console.log('========================');
};

// ==============================
// DETAILED BILLS FUNCTIONS
// ==============================

/**
 * Debounce utility function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Detailed bills state management
let detailedBillsData = [];
let filteredDetailedBills = [];
let detailedBillsCurrentPage = 1;
const detailedBillsPerPage = 20;
let detailedBillsSortField = 'bill_date';
let detailedBillsSortOrder = 'desc';

/**
 * Fetch all bills (approved, cancelled, pending) for detailed view
 */
async function fetchAllBills(fromDate = null, toDate = null) {
    try {
        console.log('🔍 Fetching all bills for detailed view from approved_bills table...');

        if (!appState.supabaseService) {
            console.error('SupabaseService not available');
            return [];
        }

        // Fetch all bills from approved_bills table using SQL function
        const allBills = await appState.supabaseService.getApprovedBillsDetailed() || [];

        console.log(`📊 Found ${allBills.length} approved bills`);

        // Note: Date filtering is handled by UI filters, not in SQL
        // This allows users to see all data and filter as needed

        return allBills;

    } catch (error) {
        console.error('❌ Error fetching all bills:', error);
        return [];
    }
}

/**
 * Load and display detailed bills
 */
async function loadDetailedBills(fromDate = null, toDate = null) {
    try {
        console.log('📋 Loading detailed bills...');

        // Fetch all bills
        detailedBillsData = await fetchAllBills(fromDate, toDate);

        // Initialize filtered bills
        filteredDetailedBills = [...detailedBillsData];

        // Populate sector filter dropdown
        populateDetailedBillsSectorFilter();

        // Apply initial sort
        sortDetailedBills(detailedBillsSortField, false);

        // Display bills
        displayDetailedBills();

        console.log('✅ Detailed bills loaded successfully');

    } catch (error) {
        console.error('❌ Error loading detailed bills:', error);
    }
}

/**
 * Populate sector filter dropdown
 */
function populateDetailedBillsSectorFilter() {
    const sectorFilter = document.getElementById('detailed-bills-sector-filter');
    if (!sectorFilter) return;

    // Get unique sectors
    const sectors = [...new Set(detailedBillsData.map(bill =>
        bill.sector || bill.Sector || 'Unknown'
    ))].sort();

    // Clear existing options except first
    sectorFilter.innerHTML = '<option value="">All Sectors</option>';

    // Add sector options
    sectors.forEach(sector => {
        const option = document.createElement('option');
        option.value = sector;
        option.textContent = sector;
        sectorFilter.appendChild(option);
    });
}

/**
 * Get payment method with proper fallback
 */
function getPaymentMethod(bill) {
    // Check various payment method field names
    let paymentMethod = bill.paymentMethod || bill.payment_method || bill.PaymentMethod || bill.Payment_Method || bill.payment_type || bill.paymentType;

    // If payment method is empty, null, or "N/A", try to infer from other fields
    if (!paymentMethod || paymentMethod === '' || paymentMethod.toLowerCase() === 'n/a' || paymentMethod.toLowerCase() === 'null') {
        // Try to infer from related fields
        if (bill.upi_id || bill.upiId || bill.UPI_ID || bill.upi_transaction_id) {
            return 'UPI';
        }
        if (bill.cheque_number || bill.chequeNumber || bill.Cheque_Number || bill.cheque_no) {
            return 'Cheque';
        }
        if (bill.bank_name || bill.bankName || bill.Bank_Name || bill.neft_details || bill.account_number) {
            return 'NEFT';
        }
        // Default fallback
        return 'Cash';
    }

    // Normalize payment method names
    const normalizedMethod = paymentMethod.toString().toLowerCase();
    if (normalizedMethod.includes('upi')) return 'UPI';
    if (normalizedMethod.includes('cheque') || normalizedMethod.includes('check')) return 'Cheque';
    if (normalizedMethod.includes('neft') || normalizedMethod.includes('bank') || normalizedMethod.includes('transfer')) return 'NEFT';
    if (normalizedMethod.includes('cash')) return 'Cash';

    // Return as-is if it's a recognized method
    const recognizedMethods = ['Cash', 'UPI', 'Cheque', 'NEFT'];
    const exactMatch = recognizedMethods.find(method => method.toLowerCase() === normalizedMethod);
    if (exactMatch) return exactMatch;

    // Return capitalized version of the payment method
    return paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).toLowerCase();
}

/**
 * Display detailed bills in table
 */
function displayDetailedBills() {
    const tbody = document.getElementById('detailed-bills-table-body');
    if (!tbody) return;

    // Calculate pagination
    const totalBills = filteredDetailedBills.length;
    const startIndex = (detailedBillsCurrentPage - 1) * detailedBillsPerPage;
    const endIndex = Math.min(startIndex + detailedBillsPerPage, totalBills);
    const pagesBills = filteredDetailedBills.slice(startIndex, endIndex);

    // Clear existing content
    tbody.innerHTML = '';

    if (pagesBills.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-gray-500">
                    <div class="flex flex-col items-center gap-2">
                        <span class="text-2xl">📄</span>
                        <span>No bills found matching the current filters</span>
                    </div>
                </td>
            </tr>
        `;
        updateDetailedBillsPagination(0, 0, 0);
        return;
    }

    // Populate rows
    pagesBills.forEach(bill => {
        const row = document.createElement('tr');
        row.className = 'border-b border-gray-100 hover:bg-gray-50';

        // Format dates
        const billDate = new Date(bill.billDate || bill.bill_date || bill.createdAt || bill.created_at);
        const formattedDate = billDate.toLocaleDateString('en-IN');

        // Get amounts
        const netAmount = parseFloat(bill.netAmount || bill.net_amount || bill.Net_Amount || 0);
        const receivedAmount = parseFloat(bill.receivedAmount || bill.received_amount || bill.Received_Amount || 0);

        // Get payment method
        const paymentMethod = getPaymentMethod(bill);

        // Get status with proper styling
        const status = bill.status || 'pending';
        let statusBadge = '';
        switch (status.toLowerCase()) {
            case 'approved':
                statusBadge = '<span class="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">Approved</span>';
                break;
            case 'cancelled':
                statusBadge = '<span class="px-2 py-1 bg-red-100 text-red-800 text-xs font-semibold rounded-full">Cancelled</span>';
                break;
            case 'delivered':
                statusBadge = '<span class="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">Delivered</span>';
                break;
            case 'edited':
                statusBadge = '<span class="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">Edited</span>';
                break;
            case 'pending':
            case 'staged':
            default:
                statusBadge = '<span class="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded-full">Pending</span>';
                break;
        }

        // Photo cell with loading state - will be populated by loadDetailedBillsPhotos()
        const billNum = bill.billNumber || bill.bill_number || 'N/A';
        const photoCell = `<div class="detailed-bill-photo-cell" data-bill-number="${billNum}">
            <div class="flex items-center justify-center">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            </div>
        </div>`;

        row.innerHTML = `
            <td class="p-3 font-mono text-sm">${bill.billNumber || bill.bill_number || 'N/A'}</td>
            <td class="p-3">${formattedDate}</td>
            <td class="p-3">${bill.retailerName || bill.retailer_name || bill.Retailer_Name || 'N/A'}</td>
            <td class="p-3">${bill.sector || bill.Sector || 'Unknown'}</td>
            <td class="p-3 text-right font-semibold">₹${netAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
            <td class="p-3">${paymentMethod}</td>
            <td class="p-3 text-center">${photoCell}</td>
        `;

        tbody.appendChild(row);
    });

    // Update pagination info
    updateDetailedBillsPagination(startIndex + 1, endIndex, totalBills);

    // Load photos from bill_photos table
    loadDetailedBillsPhotos(pagesBills);
}

/**
 * Update pagination controls
 */
function updateDetailedBillsPagination(start, end, total) {
    const startSpan = document.getElementById('detailed-bills-showing-start');
    const endSpan = document.getElementById('detailed-bills-showing-end');
    const totalSpan = document.getElementById('detailed-bills-total');
    const pageInfo = document.getElementById('detailed-bills-page-info');
    const prevBtn = document.getElementById('detailed-bills-prev-page');
    const nextBtn = document.getElementById('detailed-bills-next-page');

    if (startSpan) startSpan.textContent = start;
    if (endSpan) endSpan.textContent = end;
    if (totalSpan) totalSpan.textContent = total;

    const totalPages = Math.ceil(total / detailedBillsPerPage);
    if (pageInfo) pageInfo.textContent = `Page ${detailedBillsCurrentPage} of ${totalPages}`;

    if (prevBtn) {
        prevBtn.disabled = detailedBillsCurrentPage <= 1;
        prevBtn.onclick = () => {
            if (detailedBillsCurrentPage > 1) {
                detailedBillsCurrentPage--;
                displayDetailedBills();
            }
        };
    }

    if (nextBtn) {
        nextBtn.disabled = detailedBillsCurrentPage >= totalPages;
        nextBtn.onclick = () => {
            if (detailedBillsCurrentPage < totalPages) {
                detailedBillsCurrentPage++;
                displayDetailedBills();
            }
        };
    }
}

/**
 * Load photos from bill_photos table for Detailed Bills View
 */
async function loadDetailedBillsPhotos(bills) {
    console.log(`📸 Loading photos for ${bills.length} detailed bills from bill_photos table...`);

    for (const bill of bills) {
        try {
            const billNumber = bill.billNumber || bill.bill_number;
            if (!billNumber) continue;

            // Get photo cell element
            const photoCell = document.querySelector(`.detailed-bill-photo-cell[data-bill-number="${billNumber}"]`);
            if (!photoCell) continue;

            // Fetch photos from bill_photos table
            const photos = await getBillPhotos(billNumber, 'supply');

            if (photos && photos.length > 0) {
                const photoUrl = photos[0].photo_url; // Get most recent photo

                // Replace loading spinner with photo thumbnail using supply modal
                photoCell.innerHTML = `
                    <img src="${photoUrl}" 
                         alt="Bill Photo" 
                         class="w-16 h-16 object-cover rounded cursor-pointer hover:opacity-80 transition-opacity mx-auto" 
                         data-photo-url="${photoUrl}"
                         data-bill-number="${billNumber}"
                         onclick="openSupplyPhotoModal('${photoUrl}', '${billNumber}')">
                `;
            } else {
                // No photo found - show "No Photo" message
                photoCell.innerHTML = `<span class="text-gray-400 text-xs">No Photo</span>`;
            }
        } catch (error) {
            console.error(`❌ Error loading photo for bill ${bill.billNumber || bill.bill_number}:`, error);
            // Show error state
            const billNumber = bill.billNumber || bill.bill_number;
            const photoCell = document.querySelector(`.detailed-bill-photo-cell[data-bill-number="${billNumber}"]`);
            if (photoCell) {
                photoCell.innerHTML = `<span class="text-gray-400 text-xs">No Photo</span>`;
            }
        }
    }

    console.log('✅ Finished loading all detailed bills photos');
}

/**
 * Sort detailed bills
 */
function sortDetailedBills(field, toggleOrder = true) {
    if (toggleOrder && detailedBillsSortField === field) {
        detailedBillsSortOrder = detailedBillsSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        detailedBillsSortField = field;
        detailedBillsSortOrder = 'asc';
    }

    filteredDetailedBills.sort((a, b) => {
        let aVal, bVal;

        switch (field) {
            case 'bill_number':
                aVal = a.billNumber || a.bill_number || '';
                bVal = b.billNumber || b.bill_number || '';
                break;
            case 'bill_date':
                aVal = new Date(a.billDate || a.bill_date || a.createdAt || a.created_at);
                bVal = new Date(b.billDate || b.bill_date || b.createdAt || b.created_at);
                break;
            case 'retailer_name':
                aVal = a.retailerName || a.retailer_name || a.Retailer_Name || '';
                bVal = b.retailerName || b.retailer_name || b.Retailer_Name || '';
                break;
            case 'sector':
                aVal = a.sector || a.Sector || '';
                bVal = b.sector || b.Sector || '';
                break;
            case 'net_amount':
                aVal = parseFloat(a.netAmount || a.net_amount || a.Net_Amount || 0);
                bVal = parseFloat(b.netAmount || b.net_amount || b.Net_Amount || 0);
                break;
            case 'received_amount':
                aVal = parseFloat(a.receivedAmount || a.received_amount || a.Received_Amount || 0);
                bVal = parseFloat(b.receivedAmount || b.received_amount || b.Received_Amount || 0);
                break;
            case 'payment_method':
                aVal = getPaymentMethod(a);
                bVal = getPaymentMethod(b);
                break;
            case 'status':
                aVal = a.status || 'pending';
                bVal = b.status || 'pending';
                break;
            default:
                return 0;
        }

        if (aVal === bVal) return 0;

        const comparison = aVal < bVal ? -1 : 1;
        return detailedBillsSortOrder === 'asc' ? comparison : -comparison;
    });

    detailedBillsCurrentPage = 1;
    displayDetailedBills();
}

/**
 * Filter detailed bills
 */
function filterDetailedBills() {
    const searchTerm = document.getElementById('detailed-bills-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('detailed-bills-status-filter')?.value || '';
    const sectorFilter = document.getElementById('detailed-bills-sector-filter')?.value || '';

    filteredDetailedBills = detailedBillsData.filter(bill => {
        // Search filter
        if (searchTerm) {
            const searchFields = [
                bill.billNumber || bill.bill_number || '',
                bill.retailerName || bill.retailer_name || bill.Retailer_Name || '',
                bill.sector || bill.Sector || ''
            ];

            const matchesSearch = searchFields.some(field =>
                field.toLowerCase().includes(searchTerm)
            );

            if (!matchesSearch) return false;
        }

        // Status filter
        if (statusFilter && (bill.status || 'pending') !== statusFilter) {
            return false;
        }

        // Sector filter
        if (sectorFilter && (bill.sector || bill.Sector || 'Unknown') !== sectorFilter) {
            return false;
        }

        return true;
    });

    detailedBillsCurrentPage = 1;
    displayDetailedBills();
}

/**
 * Clear all filters
 */
function clearDetailedBillsFilters() {
    document.getElementById('detailed-bills-search').value = '';
    document.getElementById('detailed-bills-status-filter').value = '';
    document.getElementById('detailed-bills-sector-filter').value = '';

    filteredDetailedBills = [...detailedBillsData];
    detailedBillsCurrentPage = 1;
    displayDetailedBills();
}

/**
 * Export detailed bills to CSV
 */
function exportDetailedBillsCSV() {
    if (filteredDetailedBills.length === 0) {
        alert('No data to export');
        return;
    }

    const headers = ['Bill Number', 'Bill Date', 'Retailer Name', 'Sector', 'Net Amount', 'Received Amount', 'Payment Method', 'Status'];
    const csvContent = [headers.join(',')];

    filteredDetailedBills.forEach(bill => {
        const row = [
            `"${bill.billNumber || bill.bill_number || 'N/A'}"`,
            `"${new Date(bill.billDate || bill.bill_date || bill.createdAt || bill.created_at).toLocaleDateString('en-IN')}"`,
            `"${bill.retailerName || bill.retailer_name || bill.Retailer_Name || 'N/A'}"`,
            `"${bill.sector || bill.Sector || 'Unknown'}"`,
            parseFloat(bill.netAmount || bill.net_amount || bill.Net_Amount || 0),
            parseFloat(bill.receivedAmount || bill.received_amount || bill.Received_Amount || 0),
            `"${getPaymentMethod(bill)}"`,
            `"${bill.status || 'pending'}"`
        ];
        csvContent.push(row.join(','));
    });

    const blob = new Blob([csvContent.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `detailed-bills-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Initialize detailed bills event listeners
document.addEventListener('DOMContentLoaded', function () {
    // Search input
    const searchInput = document.getElementById('detailed-bills-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(filterDetailedBills, 300));
    }

    // Filter dropdowns
    const statusFilter = document.getElementById('detailed-bills-status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', filterDetailedBills);
    }

    const sectorFilter = document.getElementById('detailed-bills-sector-filter');
    if (sectorFilter) {
        sectorFilter.addEventListener('change', filterDetailedBills);
    }

    // Clear filters button
    const clearFiltersBtn = document.getElementById('clear-detailed-bills-filters');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearDetailedBillsFilters);
    }

    // Export button
    const exportBtn = document.getElementById('export-detailed-bills');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportDetailedBillsCSV);
    }
});

// Make functions available globally
window.sortDetailedBills = sortDetailedBills;

// ==============================
// TODAY'S BILLS FUNCTIONS
// ==============================

/**
 * Load and display today's approved bills
 */
async function loadTodaysBills() {
    try {
        console.log('📅 Loading today\'s bills...');

        const tbody = document.getElementById('today-bills-table-body');
        const countEl = document.getElementById('today-bills-count');
        const amountEl = document.getElementById('today-bills-amount');
        const dateEl = document.getElementById('today-bills-date');

        if (!tbody) return;

        // Show loading state
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-gray-400">
                    <div class="flex flex-col items-center gap-2">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                        <span>Loading today's bills...</span>
                    </div>
                </td>
            </tr>
        `;

        // Get today's date range (start and end of today in local timezone)
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

        const todayStartStr = todayStart.toISOString();
        const todayEndStr = todayEnd.toISOString();

        // Update date display
        if (dateEl) {
            dateEl.textContent = today.toLocaleDateString('en-IN', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }

        console.log(`🔍 Fetching bills approved between ${todayStartStr} and ${todayEndStr}`);

        // Fetch bills approved today from approved_supplies table
        const supabase = appState.supabaseService.getClient();
        const { data: todayBills, error } = await supabase
            .from('approved_supplies')
            .select('*')
            .gte('date_approved', todayStartStr)
            .lt('date_approved', todayEndStr)
            .order('date_approved', { ascending: false });

        if (error) {
            console.error('❌ Error fetching today\'s bills:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="p-8 text-center text-red-500">
                        <div class="flex flex-col items-center gap-2">
                            <span class="text-2xl">❌</span>
                            <span>Error loading today's bills</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        console.log(`✅ Found ${todayBills?.length || 0} bills approved today`);

        // Calculate totals
        const totalBills = todayBills?.length || 0;
        const totalAmount = todayBills?.reduce((sum, bill) =>
            sum + parseFloat(bill.net_amount || bill.netAmount || 0), 0) || 0;

        // Update summary
        if (countEl) countEl.textContent = totalBills;
        if (amountEl) amountEl.textContent = `₹${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

        // Display bills
        if (!todayBills || todayBills.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="p-8 text-center text-gray-500">
                        <div class="flex flex-col items-center gap-2">
                            <span class="text-2xl">📭</span>
                            <span>No bills approved today yet</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Clear loading state
        tbody.innerHTML = '';

        // Populate rows
        todayBills.forEach(bill => {
            const row = document.createElement('tr');
            row.className = 'border-b border-gray-100 hover:bg-blue-50 transition-colors';

            // Format bill date
            const billDate = new Date(bill.bill_date || bill.billDate || bill.created_at);
            const formattedDate = billDate.toLocaleDateString('en-IN');

            // Get amounts
            const netAmount = parseFloat(bill.net_amount || bill.netAmount || 0);

            // Get payment method
            const paymentMethod = bill.payment_method || bill.paymentMethod || 'Cash';

            // Photo cell with loading state
            const billNum = bill.bill_number || bill.billNumber || 'N/A';
            const photoCell = `<div class="today-bill-photo-cell" data-bill-number="${billNum}">
                <div class="flex items-center justify-center">
                    <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                </div>
            </div>`;

            row.innerHTML = `
                <td class="p-3 font-mono text-sm text-blue-600 font-semibold">${billNum}</td>
                <td class="p-3">${formattedDate}</td>
                <td class="p-3">${bill.retailer_name || bill.retailerName || 'N/A'}</td>
                <td class="p-3">
                    <span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
                        ${bill.sector || 'Unknown'}
                    </span>
                </td>
                <td class="p-3 text-right font-bold text-green-600">₹${netAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                <td class="p-3">
                    <span class="px-2 py-1 ${getPaymentMethodBadgeClass(paymentMethod)} text-xs rounded-full font-semibold">
                        ${paymentMethod}
                    </span>
                </td>
                <td class="p-3 text-center">${photoCell}</td>
            `;

            tbody.appendChild(row);
        });

        // Load photos from bill_photos table
        loadTodayBillsPhotos(todayBills);

    } catch (error) {
        console.error('❌ Error loading today\'s bills:', error);
        const tbody = document.getElementById('today-bills-table-body');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="p-8 text-center text-red-500">
                        <div class="flex flex-col items-center gap-2">
                            <span class="text-2xl">❌</span>
                            <span>Error loading today's bills</span>
                        </div>
                    </td>
                </tr>
            `;
        }
    }
}

/**
 * Get badge class for payment method
 */
function getPaymentMethodBadgeClass(method) {
    const normalized = (method || 'cash').toLowerCase();
    if (normalized === 'cash') return 'bg-green-100 text-green-700';
    if (normalized === 'upi') return 'bg-blue-100 text-blue-700';
    if (normalized === 'cheque') return 'bg-yellow-100 text-yellow-700';
    if (normalized === 'neft') return 'bg-indigo-100 text-indigo-700';
    if (normalized === 'credit') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-700';
}

/**
 * Load photos for today's bills
 */
async function loadTodayBillsPhotos(bills) {
    try {
        if (!bills || bills.length === 0) return;

        const supabase = appState.supabaseService.getClient();
        const billNumbers = bills.map(b => b.bill_number || b.billNumber).filter(Boolean);

        if (billNumbers.length === 0) return;

        // Fetch photos from bill_photos table
        const { data: photos, error } = await supabase
            .from('bill_photos')
            .select('bill_number, photo_url')
            .in('bill_number', billNumbers);

        if (error) {
            console.error('❌ Error fetching today\'s bill photos:', error);
            return;
        }

        // Create a map of bill_number to photo_url
        const photoMap = new Map();
        photos?.forEach(photo => {
            if (!photoMap.has(photo.bill_number)) {
                photoMap.set(photo.bill_number, photo.photo_url);
            }
        });

        // Update photo cells
        document.querySelectorAll('.today-bill-photo-cell').forEach(cell => {
            const billNumber = cell.dataset.billNumber;
            const photoUrl = photoMap.get(billNumber);

            if (photoUrl) {
                cell.innerHTML = `
                    <button onclick="openSupplyPhotoModal('${photoUrl}', '${billNumber}')" 
                            class="text-blue-600 hover:text-blue-800 transition-colors">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </button>
                `;
            } else {
                cell.innerHTML = `
                    <span class="text-gray-400 text-xs">No photo</span>
                `;
            }
        });

    } catch (error) {
        console.error('❌ Error loading today\'s bill photos:', error);
    }
}

/**
 * Initialize today's bills section
 */
document.addEventListener('DOMContentLoaded', function () {
    // Load today's bills when supply analysis section is visible
    const refreshBtn = document.getElementById('refresh-today-bills');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadTodaysBills);
    }

    // Auto-load when supply tab is activated
    const supplyTab = document.querySelector('[data-tab="supply"]');
    if (supplyTab) {
        const originalClickHandler = supplyTab.onclick;
        supplyTab.onclick = function () {
            if (originalClickHandler) originalClickHandler.call(this);
            setTimeout(() => {
                const todayBillsSection = document.getElementById('today-bills-table-body');
                if (todayBillsSection) {
                    loadTodaysBills();
                }
            }, 500);
        };
    }
});

// Make function available globally
window.loadTodaysBills = loadTodaysBills;

// ==============================
// UGRAI ANALYSIS FUNCTIONS
// ==============================

/**
 * Fetch completed ugrai with optional date filtering
 */
async function fetchCompletedUgrai(fromDate = null, toDate = null) {
    try {
        console.log('🔍 Fetching completed ugrai for analysis...');

        if (!appState.supabaseService) {
            console.error('SupabaseService not available');
            return [];
        }

        let allUgraiData = [];
        const processedUgraiNumbers = new Set();

        // First priority: Fetch from approved_ugrai table (most likely source)
        console.log('📊 Fetching from approved_ugrai table...');
        const approvedUgrai = await appState.supabaseService.getAllApprovedUgrai() || [];
        console.log(`📊 Found ${approvedUgrai.length} entries in approved_ugrai table`);

        // Map approved ugrai to expected format
        approvedUgrai.forEach(ugrai => {
            const ugraiNumber = ugrai.billNumber || ugrai.bill_number;
            if (ugraiNumber && !processedUgraiNumbers.has(ugraiNumber)) {
                processedUgraiNumbers.add(ugraiNumber);

                // Map fields to expected analysis format
                const mappedUgrai = {
                    ...ugrai,
                    ugrai_number: ugraiNumber,
                    completion_date: ugrai.dateApproved || ugrai.date_approved || ugrai.billDate || ugrai.bill_date,
                    retailer_name: ugrai.retailerName || ugrai.retailer_name,
                    net_amount: ugrai.netAmount || ugrai.net_amount,
                    received_amount: ugrai.receivedAmount || ugrai.received_amount,
                    payment_method: ugrai.paymentMethod || ugrai.payment_method,
                    sector: ugrai.sector
                };

                allUgraiData.push(mappedUgrai);
            }
        });

        // Second: Try completed_ugrai table (PRIMARY SOURCE - Your 4k imported bills)
        console.log('📊 Fetching from completed_ugrai table...');
        const completedUgrai = await appState.supabaseService.getCompletedUgrai() || [];
        console.log(`📊 Found ${completedUgrai.length} entries in completed_ugrai table`);
        console.log(`📊 completed_ugrai pagination check: If this shows 1000, pagination failed. If ~4000, pagination worked!`);

        completedUgrai.forEach(ugrai => {
            const ugraiNumber = ugrai.ugrai_number || ugrai.billNumber || ugrai.bill_number;
            if (ugraiNumber && !processedUgraiNumbers.has(ugraiNumber)) {
                processedUgraiNumbers.add(ugraiNumber);
                allUgraiData.push(ugrai);
            }
        });

        // Apply sector mapping for bills with null/undefined/Unknown sectors
        console.log('🗺️ Applying sector mapping from retailers...');
        const retailers = appState.data.retailers || [];
        const retailerSectorMap = new Map();
        retailers.forEach(r => {
            if (r.name && r.sector) {
                retailerSectorMap.set(r.name.toLowerCase().trim(), r.sector);
            }
        });

        let mappedCount = 0;
        allUgraiData = allUgraiData.map(ugrai => {
            const currentSector = ugrai.sector || ugrai.Sector;
            if (!currentSector || currentSector === '' || currentSector === 'Unknown' || currentSector === 'unknown') {
                const retailerName = ugrai.retailerName || ugrai.retailer_name || ugrai.Retailer_Name;
                if (retailerName) {
                    const lookupKey = retailerName.toLowerCase().trim();
                    const sector = retailerSectorMap.get(lookupKey);
                    if (sector) {
                        mappedCount++;
                        return { ...ugrai, sector };
                    }
                }
            }
            return ugrai;
        });

        if (mappedCount > 0) {
            console.log(`✅ Mapped sectors for ${mappedCount} UGRAI bills using retailer lookup`);
        } else {
            console.log(`ℹ️ No sector mapping needed (all bills already have sectors or no matching retailers)`);
        }

        // Third: Try ugrai_completed table
        console.log('📊 Fetching from ugrai_completed table...');
        const completedUgraiNew = await appState.supabaseService.getCompletedUgraiNew() || [];
        console.log(`📊 Found ${completedUgraiNew.length} entries in ugrai_completed table`);

        completedUgraiNew.forEach(ugrai => {
            const ugraiNumber = ugrai.ugrai_number || ugrai.billNumber || ugrai.bill_number;
            if (ugraiNumber && !processedUgraiNumbers.has(ugraiNumber)) {
                processedUgraiNumbers.add(ugraiNumber);
                allUgraiData.push(ugrai);
            }
        });

        console.log(`📊 Total unique ugrai entries found: ${allUgraiData.length}`);
        console.log('📊 Data sources breakdown:', {
            approved: approvedUgrai.length,
            completed: completedUgrai.length,
            completed_new: completedUgraiNew.length,
            total_unique: allUgraiData.length
        });

        // Debug: Log first ugrai to see structure
        if (allUgraiData.length > 0) {
            console.log('🔍 Sample ugrai structure:', allUgraiData[0]);
            console.log('🔍 Available fields:', Object.keys(allUgraiData[0]));
        }

        // Apply date filtering if specified
        if (fromDate || toDate) {
            const originalCount = allUgraiData.length;
            allUgraiData = allUgraiData.filter(ugrai => {
                // Try multiple possible date field names including approved ugrai fields
                const ugraiDate = new Date(
                    ugrai.completion_date ||
                    ugrai.date_approved ||
                    ugrai.dateApproved ||
                    ugrai.billDate ||
                    ugrai.bill_date ||
                    ugrai.dateCompleted ||
                    ugrai.date_completed ||
                    ugrai.completedDate ||
                    ugrai.completed_date ||
                    ugrai.createdAt ||
                    ugrai.created_at
                );

                // Debug the date filtering
                if (originalCount <= 10) { // Only log if small dataset
                    console.log(`🔍 Ugrai ${ugrai.billNumber || ugrai.ugrai_number || ugrai.id}: date=${ugraiDate}, fromDate=${fromDate}, toDate=${toDate}`);
                }

                if (fromDate && ugraiDate < new Date(fromDate)) return false;
                if (toDate && ugraiDate > new Date(toDate + 'T23:59:59')) return false;
                return true;
            });
            console.log(`📅 After date filtering: ${allUgraiData.length} ugrai (was ${originalCount})`);
        }

        console.log(`✅ fetchCompletedUgrai FINAL RESULT: Returning ${allUgraiData.length} total ugrai records`);
        console.log(`📊 If you see ~4000 here, pagination is working. If 1000, there's an issue.`);

        return allUgraiData;

    } catch (error) {
        console.error('❌ Error fetching completed ugrai:', error);
        return [];
    }
}

/**
 * Fetch ALL ugrai bills from all sources with proper status
 * Returns bills from: Pending, In Progress, Processed (Completed), and Approved
 */
async function fetchAllUgraiBills(fromDate = null, toDate = null) {
    try {
        console.log('🔍 Fetching ALL ugrai bills from all sources...');

        let allBills = [];
        const processedBillNumbers = new Set();

        // 1. APPROVED UGRAI (Final approved bills)
        console.log('📊 Fetching from approved_ugrai table...');
        const approvedUgrai = await appState.supabaseService.getAllApprovedUgrai() || [];
        console.log(`✅ Found ${approvedUgrai.length} Approved bills`);

        approvedUgrai.forEach(bill => {
            const billNumber = bill.billNumber || bill.bill_number;
            if (billNumber && !processedBillNumbers.has(billNumber)) {
                processedBillNumbers.add(billNumber);
                allBills.push({
                    ...bill,
                    status: 'Approved',
                    _source: 'approved_ugrai table (database)',
                    _statusReason: 'Bill has been approved by management',
                    ugrai_number: billNumber,
                    completion_date: bill.dateApproved || bill.date_approved || bill.billDate || bill.bill_date,
                    retailer_name: bill.retailerName || bill.retailer_name,
                    net_amount: bill.netAmount || bill.net_amount,
                    received_amount: bill.receivedAmount || bill.received_amount,
                    payment_method: bill.paymentMethod || bill.payment_method,
                    sector: bill.sector,
                    bill_date: bill.billDate || bill.bill_date
                });
            }
        });

        // 2. COMPLETED UGRAI (Processed/ready for approval from completed_ugrai table)
        console.log('📊 Fetching from completed_ugrai table...');
        const completedUgrai = await appState.supabaseService.getCompletedUgrai() || [];
        console.log(`✅ Found ${completedUgrai.length} Processed bills from completed_ugrai table`);

        completedUgrai.forEach(bill => {
            const billNumber = bill.ugrai_number || bill.billNumber || bill.bill_number;

            // DEBUG: Log specific bill if found
            if (billNumber && billNumber.toString().toUpperCase() === 'L4752') {
                console.warn('🚨 DEBUG: Found L4752 in completed_ugrai table!', {
                    billNumber: billNumber,
                    retailer: bill.retailer_name || bill.retailerName,
                    sector: bill.sector,
                    netAmount: bill.net_amount || bill.netAmount,
                    receivedAmount: bill.received_amount || bill.receivedAmount,
                    completionDate: bill.completion_date || bill.completionDate,
                    rawBillData: bill
                });
            }

            if (billNumber && !processedBillNumbers.has(billNumber)) {
                processedBillNumbers.add(billNumber);

                // Check if partial payment
                const netAmount = parseFloat(bill.net_amount || bill.netAmount || 0);
                const receivedAmount = parseFloat(bill.received_amount || bill.receivedAmount || 0);
                const isPartialPayment = receivedAmount > 0 && receivedAmount < netAmount;

                allBills.push({
                    ...bill,
                    status: 'Processed',
                    _source: 'completed_ugrai table (database)',
                    _statusReason: isPartialPayment
                        ? `Bill marked as Processed in database - Partial payment (₹${receivedAmount.toLocaleString()} of ₹${netAmount.toLocaleString()})`
                        : 'Bill marked as Processed in database - Ready for approval',
                    isPartialPayment: isPartialPayment,
                    ugrai_number: billNumber,
                    completion_date: bill.completion_date || bill.completionDate || bill.dateCompleted || bill.billDate,
                    retailer_name: bill.retailer_name || bill.retailerName,
                    net_amount: netAmount,
                    received_amount: receivedAmount,
                    payment_method: bill.payment_method || bill.paymentMethod,
                    sector: bill.sector,
                    bill_date: bill.bill_date || bill.billDate
                });
            }
        });

        // 3. COMPLETED UGRAI from appState (Use their actual status - could be various statuses)
        console.log('📊 Fetching from appState.data.completedUgrai...');
        const appStateCompleted = appState.data.completedUgrai || [];
        console.log(`✅ Found ${appStateCompleted.length} bills from appState.completedUgrai`);

        appStateCompleted.forEach(bill => {
            const billNumber = bill.billNumber || bill.ugrai_number || bill.bill_number;
            if (billNumber && !processedBillNumbers.has(billNumber)) {
                processedBillNumbers.add(billNumber);

                // Check if partial payment
                const netAmount = parseFloat(bill.netAmount || bill.net_amount || 0);
                const receivedAmount = parseFloat(bill.receivedAmount || bill.received_amount || 0);
                const isPartialPayment = receivedAmount > 0 && receivedAmount < netAmount;

                // Use the bill's actual status or default to 'Completed' (not 'Processed')
                const billStatus = bill.status || 'Completed';

                allBills.push({
                    ...bill,
                    status: billStatus, // Use actual status from bill
                    _source: 'appState.data.completedUgrai (in-memory)',
                    _statusReason: `Bill has status="${billStatus}" from in-memory data${isPartialPayment ? ' - Partial payment' : ''}`,
                    isPartialPayment: isPartialPayment,
                    ugrai_number: billNumber,
                    completion_date: bill.dateCompleted || bill.completionDate || bill.billDate,
                    retailer_name: bill.retailerName || bill.retailer_name,
                    net_amount: netAmount,
                    received_amount: receivedAmount,
                    payment_method: bill.paymentMethod || bill.payment_method,
                    sector: bill.sector,
                    bill_date: bill.billDate || bill.bill_date
                });
            }
        });

        // 4. IN PROGRESS UGRAI (Bills assigned and being worked on)
        console.log('📊 Fetching from appState.data.ugraiInProgress...');
        const inProgressBills = appState.data.ugraiInProgress || [];
        console.log(`✅ Found ${inProgressBills.length} In Progress bills`);

        inProgressBills.forEach(bill => {
            const billNumber = bill.billNumber || bill.ugrai_number || bill.bill_number;
            if (billNumber && !processedBillNumbers.has(billNumber)) {
                processedBillNumbers.add(billNumber);
                allBills.push({
                    ...bill,
                    status: 'In Progress',
                    _source: 'appState.data.ugraiInProgress (in-memory)',
                    _statusReason: `Bill assigned to ${bill.assignedTo || 'someone'} and being worked on`,
                    ugrai_number: billNumber,
                    retailer_name: bill.retailerName || bill.retailer_name,
                    net_amount: bill.netAmount || bill.net_amount,
                    received_amount: 0,
                    payment_method: 'N/A',
                    sector: bill.sector,
                    bill_date: bill.billDate || bill.bill_date,
                    assignedTo: bill.assignedTo
                });
            }
        });

        // 5. PENDING UGRAI (Bills not yet assigned - fetch from DATABASE)
        console.log('📊 Fetching from ugrai_data table (database)...');
        const pendingBillsDb = await appState.supabaseService.getUgraiData() || [];
        console.log(`✅ Found ${pendingBillsDb.length} Pending bills from database`);

        pendingBillsDb.forEach(bill => {
            const billNumber = bill.billNumber || bill.ugrai_number || bill.bill_number;

            // DEBUG: Log specific bill if found
            if (billNumber && billNumber.toString().toUpperCase() === 'L4752') {
                console.warn('🚨 DEBUG: Found L4752 in ugrai_data table!', {
                    billNumber: billNumber,
                    retailer: bill.retailerName || bill.retailer_name,
                    sector: bill.sector,
                    netAmount: bill.netAmount || bill.net_amount,
                    alreadyProcessed: processedBillNumbers.has(billNumber),
                    willBeSkipped: processedBillNumbers.has(billNumber) ? 'YES - Already added from another source' : 'NO - Will be added as Pending',
                    rawBillData: bill
                });
            }

            if (billNumber && !processedBillNumbers.has(billNumber)) {
                processedBillNumbers.add(billNumber);
                allBills.push({
                    ...bill,
                    status: 'Pending',
                    _source: 'ugrai_data table (database)',
                    _statusReason: 'Bill not yet assigned to anyone - waiting to be picked up',
                    ugrai_number: billNumber,
                    retailer_name: bill.retailerName || bill.retailer_name,
                    net_amount: bill.netAmount || bill.net_amount,
                    received_amount: 0,
                    payment_method: 'N/A',
                    sector: bill.sector,
                    bill_date: bill.billDate || bill.bill_date
                });
            }
        });

        // ALSO check appState.data.ugraiData for any in-memory pending bills
        console.log('📊 Also checking appState.data.ugraiData for in-memory pending bills...');
        const pendingBillsMemory = appState.data.ugraiData || [];
        console.log(`✅ Found ${pendingBillsMemory.length} bills in appState.data.ugraiData`);

        pendingBillsMemory.forEach(bill => {
            const billNumber = bill.billNumber || bill.ugrai_number || bill.bill_number;
            if (billNumber && !processedBillNumbers.has(billNumber)) {
                processedBillNumbers.add(billNumber);
                allBills.push({
                    ...bill,
                    status: 'Pending',
                    _source: 'appState.data.ugraiData (in-memory)',
                    _statusReason: 'Bill in memory - not yet assigned',
                    ugrai_number: billNumber,
                    retailer_name: bill.retailerName || bill.retailer_name,
                    net_amount: bill.netAmount || bill.net_amount,
                    received_amount: 0,
                    payment_method: 'N/A',
                    sector: bill.sector,
                    bill_date: bill.billDate || bill.bill_date
                });
            }
        });

        console.log(`📊 Total bills collected: ${allBills.length}`);
        console.log(`📊 Status breakdown:`, {
            approved: allBills.filter(b => b.status === 'Approved').length,
            processed: allBills.filter(b => b.status === 'Processed').length,
            inProgress: allBills.filter(b => b.status === 'In Progress').length,
            pending: allBills.filter(b => b.status === 'Pending').length
        });

        // Apply date filtering if specified
        if (fromDate || toDate) {
            const originalCount = allBills.length;
            allBills = allBills.filter(bill => {
                const billDate = new Date(
                    bill.completion_date ||
                    bill.date_approved ||
                    bill.dateApproved ||
                    bill.billDate ||
                    bill.bill_date ||
                    bill.createdAt ||
                    bill.created_at
                );

                if (fromDate && billDate < new Date(fromDate)) return false;
                if (toDate && billDate > new Date(toDate + 'T23:59:59')) return false;
                return true;
            });
            console.log(`📅 After date filtering: ${allBills.length} bills (was ${originalCount})`);
        }

        console.log(`✅ fetchAllUgraiBills FINAL RESULT: Returning ${allBills.length} total bills`);
        return allBills;

    } catch (error) {
        console.error('❌ Error fetching all ugrai bills:', error);
        return [];
    }
}

/**
 * Process UGRAI SQL aggregation results into analysis data format
 * SQL function returns: payment_method, total_bills, total_net_amount
 */
function processUgraiSQLAggregation(sqlResults) {
    console.log('🔄 Processing UGRAI SQL aggregation results:', sqlResults);

    const UGRAI_PAYMENT_METHODS = ['Cash', 'UPI', 'Cheque', 'NEFT'];

    const analysisData = {
        totalUgrai: 0,
        totalAmount: 0,
        paymentMethods: {},
        retailersList: [],
        sectorsList: []
    };

    // Initialize all payment methods
    UGRAI_PAYMENT_METHODS.forEach(method => {
        analysisData.paymentMethods[method] = { count: 0, amount: 0 };
    });

    // Process SQL results
    sqlResults.forEach(row => {
        const paymentMethod = row.payment_method || 'Unknown';
        const count = parseInt(row.total_bills || 0);
        const amount = parseFloat(row.total_net_amount || 0);

        // Add to totals
        analysisData.totalUgrai += count;
        analysisData.totalAmount += amount;

        // Normalize payment method name - keep UPI and NEFT in uppercase
        let normalizedMethod;
        const upperMethod = paymentMethod.toUpperCase();
        if (upperMethod === 'UPI' || upperMethod === 'NEFT') {
            normalizedMethod = upperMethod;
        } else {
            normalizedMethod = paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).toLowerCase();
        }

        if (!analysisData.paymentMethods[normalizedMethod]) {
            analysisData.paymentMethods[normalizedMethod] = { count: 0, amount: 0 };
        }

        analysisData.paymentMethods[normalizedMethod].count = count;
        analysisData.paymentMethods[normalizedMethod].amount = amount;
    });

    console.log('✅ Using SQL aggregation results for UGRAI');
    console.log('📊 SQL-based Payment Methods:', analysisData.paymentMethods);
    console.log('💰 SQL-based Totals:', {
        totalUgrai: analysisData.totalUgrai,
        totalAmount: analysisData.totalAmount
    });

    return analysisData;
}

/**
 * Load and display ugrai analysis data
 */
async function loadUgraiAnalysis(fromDate = null, toDate = null) {
    try {
        console.log('📊 Loading ugrai analysis data using SQL aggregation...');
        console.log(`📅 Date range: ${fromDate || 'No start'} to ${toDate || 'No end'}`);
        showUgraiLoadingState(true);

        // Try SQL aggregation first (much faster and more accurate)
        const sqlSummary = await appState.supabaseService.getUgraiAnalysisSummary();

        if (sqlSummary && sqlSummary.length > 0) {
            console.log('✅ Using SQL aggregation results for UGRAI analysis');

            // Process SQL aggregation results
            const analysisData = processUgraiSQLAggregation(sqlSummary);
            analysisData.dateRange = getDateRangeText(fromDate, toDate);

            // Fetch detailed ugrai to populate retailers and sectors data
            const ugraiData = await fetchCompletedUgrai(fromDate, toDate);
            if (ugraiData && ugraiData.length > 0) {
                // Extract retailer and sector data from detailed ugrai
                const retailersMap = {};
                const sectorsMap = {};

                ugraiData.forEach(ugrai => {
                    // Track retailers
                    if (ugrai.retailer_name || ugrai.retailerName) {
                        const retailerName = ugrai.retailer_name || ugrai.retailerName;
                        if (!retailersMap[retailerName]) {
                            retailersMap[retailerName] = { count: 0, amount: 0 };
                        }
                        retailersMap[retailerName].count++;
                        retailersMap[retailerName].amount += parseFloat(ugrai.net_amount || ugrai.netAmount || 0);
                    }

                    // Track sectors
                    if (ugrai.sector) {
                        if (!sectorsMap[ugrai.sector]) {
                            sectorsMap[ugrai.sector] = { count: 0, amount: 0 };
                        }
                        sectorsMap[ugrai.sector].count++;
                        sectorsMap[ugrai.sector].amount += parseFloat(ugrai.net_amount || ugrai.netAmount || 0);
                    }
                });

                // Convert to arrays
                analysisData.retailersList = Object.entries(retailersMap).map(([name, data]) => ({
                    name,
                    count: data.count,
                    amount: data.amount
                }));

                analysisData.sectorsList = Object.entries(sectorsMap).map(([name, data]) => ({
                    name,
                    count: data.count,
                    amount: data.amount
                }));
            }

            // Update UI
            console.log('🎨 Updating UI...');
            updateUgraiAnalysisUI(analysisData);

            // Create charts
            console.log('📈 Creating charts...');
            createUgraiPaymentMethodsChart(analysisData.paymentMethods);
            createUgraiSectorChart(analysisData.sectorsList);

            // Load detailed ugrai view
            await loadDetailedUgrai(fromDate, toDate);

            // Load today's ugrai bills section
            if (typeof loadTodayUgraiBills === 'function') {
                loadTodayUgraiBills();
            }

            showUgraiLoadingState(false);
            console.log('✅ UGRAI analysis loaded successfully via SQL');
            return;
        }

        // Fallback to old method if SQL aggregation fails
        console.log('⚠️ SQL aggregation failed, falling back to client-side calculation...');

        // Fetch completed ugrai data
        const ugraiData = await fetchCompletedUgrai(fromDate, toDate);

        console.log(`📊 Received ${ugraiData ? ugraiData.length : 0} ugrai entries for analysis`);

        if (!ugraiData || ugraiData.length === 0) {
            console.log('⚠️ No completed ugrai data available for analysis');
            updateUgraiAnalysisUI({
                totalUgrai: 0,
                totalAmount: 0,
                paymentMethods: {},
                retailers: [],
                sectors: [],
                dateRange: getDateRangeText(fromDate, toDate)
            });
            showUgraiLoadingState(false);
            return;
        }

        // Calculate analysis data
        console.log('🧮 Starting analysis calculation...');
        const analysisData = calculateUgraiAnalysisData(ugraiData);
        analysisData.dateRange = getDateRangeText(fromDate, toDate);

        console.log('📊 Analysis complete. Results:', {
            totalUgrai: analysisData.totalUgrai,
            totalAmount: analysisData.totalAmount
        });

        // Update UI
        console.log('🎨 Updating UI...');
        updateUgraiAnalysisUI(analysisData);

        // Create charts
        console.log('📈 Creating charts...');
        createUgraiPaymentMethodsChart(analysisData.paymentMethods);
        createUgraiSectorChart(analysisData.sectorsList);

        // Load detailed ugrai view
        await loadDetailedUgrai(fromDate, toDate);

        // Load today's ugrai bills section
        if (typeof loadTodayUgraiBills === 'function') {
            loadTodayUgraiBills();
        }

        showUgraiLoadingState(false);
        console.log('✅ Ugrai analysis loaded successfully');

    } catch (error) {
        console.error('❌ Error loading ugrai analysis:', error);
        console.error('❌ Error stack:', error.stack);
        showUgraiLoadingState(false);

        // Show error state
        updateUgraiAnalysisUI({
            totalUgrai: 0,
            totalAmount: 0,
            paymentMethods: {},
            retailers: [],
            sectors: [],
            dateRange: 'Error loading data'
        });
    }
}

// ==============================
// TODAY'S UGRAI BILLS FUNCTIONS
// ==============================

/**
 * Load and display today's approved ugrai bills
 */
async function loadTodayUgraiBills() {
    try {
        console.log('📅 Loading today\'s ugrai bills...');

        const tbody = document.getElementById('today-ugrai-table-body');
        const countEl = document.getElementById('today-ugrai-count');
        const amountEl = document.getElementById('today-ugrai-amount');
        const dateEl = document.getElementById('today-ugrai-date');

        if (!tbody) return;

        // Show loading state
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-gray-400">
                    <div class="flex flex-col items-center gap-2">
                        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500"></div>
                        <span>Loading today's ugrai bills...</span>
                    </div>
                </td>
            </tr>
        `;

        // Get today's date range (start and end of today in local timezone)
        const today = new Date();
        const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

        const todayStartStr = todayStart.toISOString();
        const todayEndStr = todayEnd.toISOString();

        // Update date display
        if (dateEl) {
            dateEl.textContent = today.toLocaleDateString('en-IN', {
                weekday: 'short',
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        }

        console.log(`🔍 Fetching ugrai bills approved between ${todayStartStr} and ${todayEndStr}`);

        // Fetch bills approved today from approved_ugrai table
        const supabase = appState.supabaseService.getClient();
        const { data: todayUgraiBills, error } = await supabase
            .from('approved_ugrai')
            .select('*')
            .gte('date_approved', todayStartStr)
            .lt('date_approved', todayEndStr)
            .order('date_approved', { ascending: false });

        if (error) {
            console.error('❌ Error fetching today\'s ugrai bills:', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="p-8 text-center text-red-500">
                        <div class="flex flex-col items-center gap-2">
                            <span class="text-2xl">❌</span>
                            <span>Error loading today's ugrai bills</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        console.log(`✅ Found ${todayUgraiBills?.length || 0} ugrai bills approved today`);

        // Calculate totals
        const totalBills = todayUgraiBills?.length || 0;
        const totalAmount = todayUgraiBills?.reduce((sum, bill) =>
            sum + parseFloat(bill.net_amount || bill.netAmount || 0), 0) || 0;

        // Update summary
        if (countEl) countEl.textContent = totalBills;
        if (amountEl) amountEl.textContent = `₹${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

        // Display bills
        if (!todayUgraiBills || todayUgraiBills.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="p-8 text-center text-gray-500">
                        <div class="flex flex-col items-center gap-2">
                            <span class="text-2xl">📭</span>
                            <span>No ugrai bills approved today yet</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        // Clear loading state
        tbody.innerHTML = '';

        // Populate rows
        todayUgraiBills.forEach(bill => {
            const row = document.createElement('tr');
            row.className = 'border-b border-gray-100 hover:bg-green-50 transition-colors';

            // Format bill date
            const billDate = new Date(bill.bill_date || bill.billDate || bill.created_at);
            const formattedDate = billDate.toLocaleDateString('en-IN');

            // Get amounts
            const netAmount = parseFloat(bill.net_amount || bill.netAmount || 0);
            const receivedAmount = parseFloat(bill.received_amount || bill.receivedAmount || 0);

            // Get payment method
            const paymentMethod = bill.payment_method || bill.paymentMethod || 'Cash';

            row.innerHTML = `
                <td class="p-3 font-mono text-sm text-green-600 font-semibold">${bill.bill_number || bill.billNumber || 'N/A'}</td>
                <td class="p-3">${formattedDate}</td>
                <td class="p-3">${bill.retailer_name || bill.retailerName || 'N/A'}</td>
                <td class="p-3">
                    <span class="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full">
                        ${bill.sector || 'Unknown'}
                    </span>
                </td>
                <td class="p-3 text-right font-bold text-gray-700">₹${netAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                <td class="p-3 text-right font-bold text-green-600">₹${receivedAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                <td class="p-3">
                    <span class="px-2 py-1 ${getPaymentMethodBadgeClass(paymentMethod)} text-xs rounded-full font-semibold">
                        ${paymentMethod}
                    </span>
                </td>
            `;

            tbody.appendChild(row);
        });

    } catch (error) {
        console.error('❌ Error loading today\'s ugrai bills:', error);
        const tbody = document.getElementById('today-ugrai-table-body');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="p-8 text-center text-red-500">
                        <div class="flex flex-col items-center gap-2">
                            <span class="text-2xl">❌</span>
                            <span>Error loading today's ugrai bills</span>
                        </div>
                    </td>
                </tr>
            `;
        }
    }
}

/**
 * Initialize today's ugrai bills section
 */
document.addEventListener('DOMContentLoaded', function () {
    // Refresh button event listener
    const refreshBtn = document.getElementById('refresh-today-ugrai');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadTodayUgraiBills);
    }
});

// Make function available globally
window.loadTodayUgraiBills = loadTodayUgraiBills;

// ============================================================================
// PENDING BILLS ANALYSIS
// ============================================================================

/**
 * Load and display pending bills analysis
 */
async function loadPendingBillsAnalysis() {
    try {
        console.log('📊 Loading pending bills analysis...');
        showPendingBillsLoadingState(true);

        // Fetch data using SQL aggregation
        const [summary, bySector, paymentHistory, paymentByMethod] = await Promise.all([
            appState.supabaseService.getPendingBillsSummary(),
            appState.supabaseService.getPendingBillsBySector(),
            appState.supabaseService.getPaymentHistorySummary(),
            appState.supabaseService.getPaymentHistoryByMethod()
        ]);

        console.log('📊 Pending Bills Summary:', summary);
        console.log('📊 By Sector:', bySector);
        console.log('📊 Payment History:', paymentHistory);
        console.log('📊 Payment By Method:', paymentByMethod);

        // Check if data is null and log warnings
        if (!summary) console.warn('⚠️ Summary data is null');
        if (!bySector) console.warn('⚠️ Sector data is null');
        if (!paymentHistory) console.warn('⚠️ Payment history data is null');
        if (!paymentByMethod) console.warn('⚠️ Payment by method data is null');

        // Update summary cards
        updatePendingBillsSummary(summary);

        // Update sector breakdown
        updatePendingBillsSectorData(bySector);

        // Person breakdown removed
        // updatePendingBillsPersonData(byPerson);

        // Update payment history
        updatePaymentHistoryData(paymentHistory, paymentByMethod);

        // Load detailed bill list
        await loadPendingBillsDetailedTable();

        showPendingBillsLoadingState(false);
        console.log('✅ Pending bills analysis loaded successfully');

    } catch (error) {
        console.error('❌ Error loading pending bills analysis:', error);
        showPendingBillsLoadingState(false);
    }
}

/**
 * Load detailed bill-by-bill table for pending bills
 * Uses SQL function to match Total UGRAI logic exactly
 */
async function loadPendingBillsDetailedTable() {
    try {
        console.log('📋 Loading detailed pending bills table via SQL...');

        // Fetch directly from SQL function (replicates loadProcessedTotalUgrai logic)
        const pendingBills = await appState.supabaseService.getPendingBillsDetailed();

        if (!pendingBills || pendingBills.length === 0) {
            console.log('⚠️ No pending bills found');
            renderPendingBillsDetailedTable([]);
            return;
        }

        console.log(`✅ Found ${pendingBills.length} pending bills from SQL`);

        // Map SQL results to match expected format
        const allPendingBills = pendingBills.map(bill => ({
            id: bill.id,
            billNumber: bill.bill_number,
            billDate: bill.bill_date,
            retailerName: bill.retailer_name,
            sector: bill.sector,
            netAmount: parseFloat(bill.net_amount || 0),
            receivedAmount: parseFloat(bill.total_received || 0),
            dueAmount: parseFloat(bill.due_amount || 0),
            assignedTo: bill.assigned_to,
            currentStage: bill.current_stage,
            source: bill.source_table === 'ugrai_data' ? 'Ugrai Data' : 'Ugrai from Supplies',
            sourceType: bill.source_table
        }));



        // Store for search functionality
        window.allPendingBillsData = allPendingBills;

        // Render the table
        renderPendingBillsDetailedTable(allPendingBills);

        // Setup search functionality
        setupPendingBillsSearch();

    } catch (error) {
        console.error('❌ Error loading detailed pending bills:', error);
    }
}

/**
 * Render the detailed pending bills table
 */
function renderPendingBillsDetailedTable(bills) {
    const tableBody = document.getElementById('pending-bills-detail-table');
    const countElement = document.getElementById('pending-bills-detail-count');

    if (!tableBody) {
        console.error('❌ pending-bills-detail-table element not found');
        return;
    }

    // Update count
    if (countElement) {
        countElement.textContent = bills.length;
    }

    if (!bills || bills.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="7" class="px-4 py-8 text-center text-gray-500">No pending bills found</td></tr>';
        return;
    }

    // Sort by bill date (newest first)
    bills.sort((a, b) => {
        const dateA = new Date(a.billDate || a.bill_date || '1900-01-01');
        const dateB = new Date(b.billDate || b.bill_date || '1900-01-01');
        return dateB - dateA;
    });

    // Generate table rows
    tableBody.innerHTML = bills.map(bill => {
        const billNumber = bill.billNumber || bill.bill_number || 'N/A';
        const billDate = bill.billDate || bill.bill_date || 'N/A';
        const retailerName = bill.retailerName || bill.retailer_name || 'N/A';
        const sector = bill.sector || 'Unknown';
        const netAmount = parseFloat(bill.netAmount || bill.net_amount || 0);
        const receivedAmount = parseFloat(bill.receivedAmount || bill.received_amount || 0);
        const dueAmount = parseFloat(bill.dueAmount || netAmount);

        // Format date
        let formattedDate = billDate;
        if (billDate !== 'N/A') {
            try {
                formattedDate = new Date(billDate).toLocaleDateString('en-IN');
            } catch (e) {
                formattedDate = billDate;
            }
        }

        // Due amount color (red if there's outstanding amount)
        const dueAmountClass = dueAmount > 0 ? 'text-red-600' : 'text-green-600';

        return `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-3 text-gray-800">${billNumber}</td>
                <td class="p-3 text-gray-600">${formattedDate}</td>
                <td class="p-3 text-gray-800">${retailerName}</td>
                <td class="p-3 text-gray-600">${sector}</td>
                <td class="p-3 text-right font-semibold text-gray-900">₹${netAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td class="p-3 text-right font-semibold text-blue-600">₹${receivedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td class="p-3 text-right font-semibold ${dueAmountClass}">₹${dueAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            </tr>
        `;
    }).join('');

    console.log(`✅ Rendered ${bills.length} bills in detailed table`);
}

/**
 * Setup search functionality for pending bills
 */
function setupPendingBillsSearch() {
    const searchInput = document.getElementById('pending-bills-search');
    if (!searchInput) return;

    // Remove existing listener
    searchInput.removeEventListener('input', handlePendingBillsSearch);

    // Add new listener
    searchInput.addEventListener('input', handlePendingBillsSearch);
}

/**
 * Handle search input
 */
function handlePendingBillsSearch(event) {
    const searchTerm = event.target.value.toLowerCase().trim();

    if (!window.allPendingBillsData) {
        console.warn('⚠️ No pending bills data available for search');
        return;
    }

    if (!searchTerm) {
        // Show all bills if search is empty
        renderPendingBillsDetailedTable(window.allPendingBillsData);
        return;
    }

    // Filter bills based on search term
    const filteredBills = window.allPendingBillsData.filter(bill => {
        const billNumber = (bill.billNumber || bill.bill_number || '').toLowerCase();
        const retailerName = (bill.retailerName || bill.retailer_name || '').toLowerCase();
        const sector = (bill.sector || '').toLowerCase();

        return billNumber.includes(searchTerm) ||
            retailerName.includes(searchTerm) ||
            sector.includes(searchTerm);
    });

    console.log(`🔍 Search "${searchTerm}" found ${filteredBills.length} bills`);
    renderPendingBillsDetailedTable(filteredBills);
}

/**
 * Update pending bills summary cards
 */
function updatePendingBillsSummary(summary) {
    let totalBills = 0;
    let totalAmount = 0;
    let ugraiDataBills = 0;
    let ugraiDataAmount = 0;
    let ugraiEntriesBills = 0;
    let ugraiEntriesAmount = 0;

    if (summary && summary.length > 0) {
        summary.forEach(row => {
            const bills = parseInt(row.total_bills || 0);
            const amount = parseFloat(row.total_amount || 0);

            totalBills += bills;
            totalAmount += amount;

            if (row.source_table === 'ugrai_data') {
                ugraiDataBills = bills;
                ugraiDataAmount = amount;
            } else if (row.source_table === 'ugrai_entries') {
                ugraiEntriesBills = bills;
                ugraiEntriesAmount = amount;
            }
        });
    }

    // Update DOM
    document.getElementById('total-pending-bills').textContent = totalBills;
    document.getElementById('total-pending-amount').textContent = `₹${totalAmount.toLocaleString()}`;
    // Removed UGRAI-specific cards
    // document.getElementById('ugrai-data-pending').textContent = ugraiDataBills;
    // document.getElementById('ugrai-data-amount').textContent = `₹${ugraiDataAmount.toLocaleString()}`;
    // document.getElementById('ugrai-entries-pending').textContent = ugraiEntriesBills;
    // document.getElementById('ugrai-entries-amount').textContent = `₹${ugraiEntriesAmount.toLocaleString()}`;
}

/**
 * Update pending bills by sector
 */
let pendingSectorAnalysisData = [];
let pendingSectorSortState = { column: 'amount', direction: 'desc' };

function updatePendingBillsSectorData(sectorData) {
    // Store data for sorting
    pendingSectorAnalysisData = sectorData || [];

    // Render table
    renderPendingSectorTable();

    // Add click handlers to sortable headers
    setupPendingSectorTableSorting();

    // Update chart
    createPendingBillsSectorChart(sectorData);
}

function setupPendingSectorTableSorting() {
    const pendingSectorTableHeaders = document.querySelectorAll('th.sortable[data-table="pending-sector"]');

    if (!pendingSectorTableHeaders || pendingSectorTableHeaders.length === 0) {
        return;
    }

    pendingSectorTableHeaders.forEach(header => {
        // Remove existing listeners by cloning
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);

        newHeader.addEventListener('click', () => {
            const column = newHeader.dataset.column;

            // Toggle direction if same column, otherwise default to desc
            if (pendingSectorSortState.column === column) {
                pendingSectorSortState.direction = pendingSectorSortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                pendingSectorSortState.column = column;
                pendingSectorSortState.direction = 'desc';
            }

            renderPendingSectorTable();
            setupPendingSectorTableSorting(); // Re-setup handlers after re-render
        });
    });
}

function renderPendingSectorTable() {
    const tableBody = document.getElementById('pending-bills-sector-table');
    if (!tableBody) {
        console.error('❌ pending-bills-sector-table element not found');
        return;
    }

    if (!pendingSectorAnalysisData || pendingSectorAnalysisData.length === 0) {
        console.log('⚠️ No sector data available');
        tableBody.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-500">No pending bills</td></tr>';
        return;
    }

    console.log(`✅ Updating sector table with ${pendingSectorAnalysisData.length} rows`);

    // Sort the data
    const sortedSectors = [...pendingSectorAnalysisData].sort((a, b) => {
        let aVal, bVal;

        switch (pendingSectorSortState.column) {
            case 'sector':
                aVal = (a.sector || '').toLowerCase();
                bVal = (b.sector || '').toLowerCase();
                return pendingSectorSortState.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            case 'bills':
                aVal = Number(a.total_bills) || 0;
                bVal = Number(b.total_bills) || 0;
                break;
            case 'amount':
                aVal = Number(a.total_amount) || 0;
                bVal = Number(b.total_amount) || 0;
                break;
            default:
                return 0;
        }

        return pendingSectorSortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Render sorted data
    tableBody.innerHTML = sortedSectors.map(row => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="p-2 text-gray-800">${row.sector || 'Unknown'}</td>
            <td class="p-2 text-right font-semibold text-purple-600">${row.total_bills}</td>
            <td class="p-2 text-right text-gray-600">₹${Number(row.total_amount || 0).toFixed(2)}</td>
        </tr>
    `).join('');
}

/**
 * Update pending bills by person
 */
function updatePendingBillsPersonData(personData) {
    console.log('📊 updatePendingBillsPersonData called with:', personData);

    // Update table
    const tableBody = document.getElementById('pending-bills-person-table');
    if (tableBody) {
        if (!personData || personData.length === 0) {
            console.log('⚠️ No person data available');
            tableBody.innerHTML = '<tr><td colspan="3" class="px-4 py-4 text-center text-gray-500">No assignments</td></tr>';
        } else {
            console.log(`✅ Updating person table with ${personData.length} rows`);
            tableBody.innerHTML = personData.map(row => `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm text-gray-800">${row.assigned_to || 'Unassigned'}</td>
                    <td class="px-4 py-3 text-sm text-right font-semibold text-blue-600">${row.total_bills}</td>
                    <td class="px-4 py-3 text-sm text-right text-gray-600">₹${parseFloat(row.total_amount || 0).toLocaleString()}</td>
                </tr>
            `).join('');
        }
    } else {
        console.error('❌ pending-bills-person-table element not found');
    }

    // Update chart
    createPendingBillsPersonChart(personData);
}

/**
 * Update payment history data
 */
function updatePaymentHistoryData(paymentHistory, paymentByMethod) {
    let totalPayments = 0;
    let totalCollected = 0;
    let partialCount = 0;
    let partialAmount = 0;
    let fullCount = 0;
    let fullAmount = 0;

    if (paymentHistory && paymentHistory.length > 0) {
        paymentHistory.forEach(row => {
            const count = parseInt(row.total_payments || 0);
            const collected = parseFloat(row.total_amount_collected || 0);

            totalPayments += count;
            totalCollected += collected;

            if (row.payment_type === 'partial') {
                partialCount += count;
                partialAmount += collected;
            } else if (row.payment_type === 'full') {
                fullCount += count;
                fullAmount += collected;
            }
        });
    }

    // Update summary cards
    document.getElementById('total-payments-count').textContent = totalPayments;
    document.getElementById('total-payments-collected').textContent = `₹${totalCollected.toLocaleString()}`;
    document.getElementById('partial-payments-count').textContent = partialCount;
    document.getElementById('partial-payments-amount').textContent = `₹${partialAmount.toLocaleString()}`;
    document.getElementById('full-payments-count').textContent = fullCount;
    document.getElementById('full-payments-amount').textContent = `₹${fullAmount.toLocaleString()}`;

    // Update chart
    createPaymentHistoryChart(paymentByMethod);
}

/**
 * Create pending bills by sector chart
 */
function createPendingBillsSectorChart(sectorData) {
    console.log('📊 createPendingBillsSectorChart called with:', sectorData);

    const canvas = document.getElementById('pending-bills-sector-chart');
    if (!canvas) {
        console.error('❌ pending-bills-sector-chart canvas not found');
        return;
    }

    // Destroy existing chart
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    if (!sectorData || sectorData.length === 0) {
        console.log('⚠️ No sector data for chart');
        return;
    }

    console.log(`✅ Creating sector chart with ${sectorData.length} sectors`);

    const ctx = canvas.getContext('2d');
    const labels = sectorData.map(row => row.sector || 'Unknown');
    const data = sectorData.map(row => parseInt(row.total_bills || 0));
    const amounts = sectorData.map(row => parseFloat(row.total_amount || 0));

    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Pending Bills',
                data: data,
                backgroundColor: 'rgba(99, 102, 241, 0.7)',
                borderColor: 'rgba(99, 102, 241, 1)',
                borderWidth: 2,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: function (context) {
                            return `Amount: ₹${amounts[context.dataIndex].toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}

/**
 * Create pending bills by person chart
 */
function createPendingBillsPersonChart(personData) {
    console.log('📊 createPendingBillsPersonChart called with:', personData);

    const canvas = document.getElementById('pending-bills-person-chart');
    if (!canvas) {
        console.error('❌ pending-bills-person-chart canvas not found');
        return;
    }

    // Destroy existing chart
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    if (!personData || personData.length === 0) {
        console.log('⚠️ No person data for chart');
        return;
    }

    console.log(`✅ Creating person chart with ${personData.length} people`);

    const ctx = canvas.getContext('2d');
    const labels = personData.map(row => row.assigned_to || 'Unassigned');
    const data = personData.map(row => parseInt(row.total_bills || 0));
    const amounts = personData.map(row => parseFloat(row.total_amount || 0));

    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgba(59, 130, 246, 0.7)',
                    'rgba(16, 185, 129, 0.7)',
                    'rgba(245, 158, 11, 0.7)',
                    'rgba(239, 68, 68, 0.7)',
                    'rgba(139, 92, 246, 0.7)',
                    'rgba(6, 182, 212, 0.7)',
                ],
                borderColor: [
                    'rgba(59, 130, 246, 1)',
                    'rgba(16, 185, 129, 1)',
                    'rgba(245, 158, 11, 1)',
                    'rgba(239, 68, 68, 1)',
                    'rgba(139, 92, 246, 1)',
                    'rgba(6, 182, 212, 1)',
                ],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const amount = amounts[context.dataIndex];
                            return `${label}: ${value} bills (₹${amount.toLocaleString()})`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Create payment history chart
 */
function createPaymentHistoryChart(paymentData) {
    const canvas = document.getElementById('payment-history-chart');
    if (!canvas) return;

    // Destroy existing chart
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    if (!paymentData || paymentData.length === 0) return;

    const ctx = canvas.getContext('2d');
    const PAYMENT_METHODS = ['Cash', 'Cheque', 'NEFT', 'UPI'];
    const labels = PAYMENT_METHODS;
    const data = labels.map(method => {
        const row = paymentData.find(r => r.payment_method === method);
        return row ? parseInt(row.total_payments || 0) : 0;
    });
    const amounts = labels.map(method => {
        const row = paymentData.find(r => r.payment_method === method);
        return row ? parseFloat(row.total_amount_collected || 0) : 0;
    });

    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Number of Payments',
                data: data,
                backgroundColor: [
                    'rgba(34, 197, 94, 0.7)',
                    'rgba(245, 158, 11, 0.7)',
                    'rgba(139, 92, 246, 0.7)',
                    'rgba(59, 130, 246, 0.7)',
                ],
                borderColor: [
                    'rgba(34, 197, 94, 1)',
                    'rgba(245, 158, 11, 1)',
                    'rgba(139, 92, 246, 1)',
                    'rgba(59, 130, 246, 1)',
                ],
                borderWidth: 2,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: function (context) {
                            return `Collected: ₹${amounts[context.dataIndex].toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                }
            }
        }
    });
}

/**
 * Show/hide pending bills loading state
 */
function showPendingBillsLoadingState(isLoading) {
    const loadingElement = document.getElementById('pending-bills-loading');
    const summaryElement = document.getElementById('pending-bills-summary');

    if (loadingElement && summaryElement) {
        if (isLoading) {
            loadingElement.classList.remove('hidden');
            summaryElement.style.opacity = '0.5';
        } else {
            loadingElement.classList.add('hidden');
            summaryElement.style.opacity = '1';
        }
    }
}

/**
 * Show/hide ugrai loading state
 */
function showUgraiLoadingState(isLoading) {
    const loadingElement = document.getElementById('ugrai-analysis-loading');
    const contentElement = document.getElementById('ugrai-analysis-content');

    if (loadingElement && contentElement) {
        if (isLoading) {
            loadingElement.classList.remove('hidden');
            contentElement.style.opacity = '0.5';
            contentElement.style.pointerEvents = 'none';
        } else {
            loadingElement.classList.add('hidden');
            contentElement.style.opacity = '1';
            contentElement.style.pointerEvents = 'auto';
        }
    }
}

/**
 * Calculate ugrai analysis data
 */
function calculateUgraiAnalysisData(ugraiData) {
    console.log('🧮 Calculating ugrai analysis data...');
    console.log(`📊 Input data: ${ugraiData.length} ugrai entries`);

    const analysisData = {
        totalUgrai: ugraiData.length, // This should be the correct count
        totalAmount: 0,
        paymentMethods: {},
        retailers: {},
        sectors: {}
    };

    // Initialize all payment methods with zero values
    ALL_PAYMENT_METHODS.forEach(method => {
        analysisData.paymentMethods[method] = {
            count: 0,
            amount: 0
        };
    });

    console.log(`📊 Initial total ugrai count: ${analysisData.totalUgrai}`);

    ugraiData.forEach((ugrai, index) => {
        // Debug first few entries
        if (index < 3) {
            console.log(`🔍 Processing ugrai ${index + 1}:`, {
                billNumber: ugrai.billNumber || ugrai.bill_number || ugrai.ugrai_number,
                amount: ugrai.received_amount || ugrai.receivedAmount || ugrai.netAmount || ugrai.net_amount,
                paymentMethod: ugrai.paymentMethod || ugrai.payment_method,
                retailer: ugrai.retailerName || ugrai.retailer_name,
                sector: ugrai.sector,
                allFields: Object.keys(ugrai)
            });
        }

        // Total amount - try multiple possible field names (prioritizing received_amount for approved ugrai)
        const amount = parseFloat(
            ugrai.received_amount ||
            ugrai.receivedAmount ||
            ugrai.netAmount ||
            ugrai.net_amount ||
            ugrai.amount ||
            0
        );
        analysisData.totalAmount += amount;

        // Payment methods - try multiple possible field names
        let paymentMethod = (ugrai.paymentMethod || ugrai.payment_method || ugrai.deliveryMethod || 'Other').toString().trim();

        // Normalize payment method names
        const paymentMapping = {
            'cash': 'Cash',
            'credit': 'Credit',
            'upi': 'UPI',
            'cheque': 'Cheque',
            'neft': 'NEFT',
            'rtgs': 'NEFT',  // Map RTGS to NEFT
            'bank transfer': 'NEFT',  // Map Bank Transfer to NEFT
            'bank_transfer': 'NEFT',  // Map Bank Transfer to NEFT
            'direct': 'Cash',
            'courier': 'Other',
            'self': 'Cash'
        };

        const normalizedMethod = paymentMapping[paymentMethod.toLowerCase()] || 'Other';

        // Ensure the payment method exists in our data structure
        if (!analysisData.paymentMethods[normalizedMethod]) {
            analysisData.paymentMethods[normalizedMethod] = { count: 0, amount: 0 };
        }

        analysisData.paymentMethods[normalizedMethod].count++;
        analysisData.paymentMethods[normalizedMethod].amount += amount;

        // Retailers - try multiple possible field names
        const retailer = ugrai.retailerName || ugrai.retailer_name || ugrai.retailer || 'Unknown';
        if (!analysisData.retailers[retailer]) {
            analysisData.retailers[retailer] = {
                count: 0,
                amount: 0,
                sector: ugrai.sector || 'Unknown'
            };
        }
        analysisData.retailers[retailer].count++;
        analysisData.retailers[retailer].amount += amount;

        // Sectors
        const sector = ugrai.sector || 'Unknown';
        if (!analysisData.sectors[sector]) {
            analysisData.sectors[sector] = {
                count: 0,
                amount: 0,
                retailers: new Set()
            };
        }
        analysisData.sectors[sector].count++;
        analysisData.sectors[sector].amount += amount;
        analysisData.sectors[sector].retailers.add(retailer);
    });

    // Convert to arrays and sort
    analysisData.retailersList = Object.entries(analysisData.retailers)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.amount - a.amount);

    analysisData.sectorsList = Object.entries(analysisData.sectors)
        .map(([name, data]) => ({
            name,
            count: data.count,
            amount: data.amount,
            retailerCount: data.retailers.size
        }))
        .sort((a, b) => b.amount - a.amount);

    console.log('📊 Final analysis data:', {
        totalUgrai: analysisData.totalUgrai,
        totalAmount: analysisData.totalAmount,
        retailersCount: analysisData.retailersList.length,
        sectorsCount: analysisData.sectorsList.length,
        paymentMethodsWithData: Object.keys(analysisData.paymentMethods).filter(pm => analysisData.paymentMethods[pm].count > 0)
    });

    return analysisData;
}

/**
 * Update the ugrai analysis UI with data
 */
function updateUgraiAnalysisUI(data) {
    // Update cards
    const totalUgraiElement = document.getElementById('ugrai-analysis-total-count');
    const totalAmountElement = document.getElementById('ugrai-analysis-total-amount');
    const dateRangeElement = document.getElementById('ugrai-analysis-date-range');

    if (totalUgraiElement) {
        totalUgraiElement.textContent = data.totalUgrai.toLocaleString();
    }

    if (totalAmountElement) {
        totalAmountElement.textContent = `₹${data.totalAmount.toLocaleString()}`;
    }

    if (dateRangeElement) {
        dateRangeElement.textContent = data.dateRange || 'All completed ugrai entries';
    }

    // Update retailer tables
    updateUgraiRetailerTables(data.retailersList);

    // Update sector table
    updateUgraiSectorTable(data.sectorsList);
}

/**
 * Update ugrai retailer analysis tables
 */
/**
 * Ugrai Analysis Sorting
 */
let ugraiRetailerAnalysisData = [];
let ugraiRetailerBillsSortState = { column: 'bills', direction: 'desc' };
let ugraiRetailerAmountSortState = { column: 'amount', direction: 'desc' };

let ugraiSectorAnalysisData = [];
let ugraiSectorSortState = { column: 'amount', direction: 'desc' };

function updateUgraiRetailerTables(retailers) {
    // Store retailers data for sorting
    ugraiRetailerAnalysisData = retailers || [];

    // Render both tables
    renderUgraiRetailerBillsTable();
    renderUgraiRetailerAmountTable();

    // Add click handlers to both tables
    setupUgraiRetailerTableSorting();
}

function setupUgraiRetailerTableSorting() {
    // Get all sortable headers
    const allHeaders = document.querySelectorAll('th.sortable[data-table^="ugrai-"]');

    allHeaders.forEach(header => {
        // Remove existing listeners by cloning
        const newHeader = header.cloneNode(true);
        header.parentNode.replaceChild(newHeader, header);

        newHeader.addEventListener('click', () => {
            const column = newHeader.dataset.column;
            const table = newHeader.dataset.table;

            if (table === 'ugrai-bills') {
                // Toggle direction if same column, otherwise default to desc
                if (ugraiRetailerBillsSortState.column === column) {
                    ugraiRetailerBillsSortState.direction = ugraiRetailerBillsSortState.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    ugraiRetailerBillsSortState.column = column;
                    ugraiRetailerBillsSortState.direction = 'desc';
                }
                renderUgraiRetailerBillsTable();
            } else if (table === 'ugrai-amount') {
                // Toggle direction if same column, otherwise default to desc
                if (ugraiRetailerAmountSortState.column === column) {
                    ugraiRetailerAmountSortState.direction = ugraiRetailerAmountSortState.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    ugraiRetailerAmountSortState.column = column;
                    ugraiRetailerAmountSortState.direction = 'desc';
                }
                renderUgraiRetailerAmountTable();
            } else if (table === 'ugrai-sector') {
                // Toggle direction if same column, otherwise default to desc
                if (ugraiSectorSortState.column === column) {
                    ugraiSectorSortState.direction = ugraiSectorSortState.direction === 'asc' ? 'desc' : 'asc';
                } else {
                    ugraiSectorSortState.column = column;
                    ugraiSectorSortState.direction = 'desc';
                }
                renderUgraiSectorTable();
            }

            // Re-setup handlers after re-render
            setupUgraiRetailerTableSorting();
        });
    });
}

function renderUgraiRetailerBillsTable() {
    const billsTable = document.getElementById('ugrai-retailer-bills-table');
    if (!billsTable) return;

    // Sort the data
    const sortedRetailers = [...ugraiRetailerAnalysisData].sort((a, b) => {
        let aVal, bVal;

        switch (ugraiRetailerBillsSortState.column) {
            case 'retailer':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                return ugraiRetailerBillsSortState.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            case 'bills':
                aVal = Number(a.count) || 0;
                bVal = Number(b.count) || 0;
                break;
            case 'amount':
                aVal = Number(a.amount) || 0;
                bVal = Number(b.amount) || 0;
                break;
            default:
                return 0;
        }

        return ugraiRetailerBillsSortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    billsTable.innerHTML = sortedRetailers.map(retailer => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="p-2 text-gray-800">${retailer.name}</td>
            <td class="p-2 text-right font-semibold text-green-600">${retailer.count}</td>
            <td class="p-2 text-right text-gray-600">₹${Number(retailer.amount).toFixed(2)}</td>
        </tr>
    `).join('') || '<tr><td colspan="3" class="p-4 text-center text-gray-500">No data available</td></tr>';
}

function renderUgraiRetailerAmountTable() {
    const amountTable = document.getElementById('ugrai-retailer-amount-table');
    if (!amountTable) return;

    // Sort the data
    const sortedRetailers = [...ugraiRetailerAnalysisData].sort((a, b) => {
        let aVal, bVal;

        switch (ugraiRetailerAmountSortState.column) {
            case 'retailer':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                return ugraiRetailerAmountSortState.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            case 'amount':
                aVal = Number(a.amount) || 0;
                bVal = Number(b.amount) || 0;
                break;
            case 'bills':
                aVal = Number(a.count) || 0;
                bVal = Number(b.count) || 0;
                break;
            default:
                return 0;
        }

        return ugraiRetailerAmountSortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    amountTable.innerHTML = sortedRetailers.map(retailer => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="p-2 text-gray-800">${retailer.name}</td>
            <td class="p-2 text-right font-semibold text-emerald-600">₹${Number(retailer.amount).toFixed(2)}</td>
            <td class="p-2 text-right text-gray-600">${retailer.count}</td>
        </tr>
    `).join('') || '<tr><td colspan="3" class="p-4 text-center text-gray-500">No data available</td></tr>';
}

/**
 * Update ugrai sector analysis table
 */
function updateUgraiSectorTable(sectors) {
    // Store sectors data for sorting
    ugraiSectorAnalysisData = sectors || [];

    // Render the table
    renderUgraiSectorTable();

    // Add click handlers to sortable headers
    setupUgraiRetailerTableSorting();
}

function renderUgraiSectorTable() {
    const sectorTable = document.getElementById('ugrai-sector-analysis-table');
    if (!sectorTable) return;

    // Sort the data
    const sortedSectors = [...ugraiSectorAnalysisData].sort((a, b) => {
        let aVal, bVal;

        switch (ugraiSectorSortState.column) {
            case 'sector':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                return ugraiSectorSortState.direction === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            case 'bills':
                aVal = Number(a.count) || 0;
                bVal = Number(b.count) || 0;
                break;
            case 'amount':
                aVal = Number(a.amount) || 0;
                bVal = Number(b.amount) || 0;
                break;
            default:
                return 0;
        }

        return ugraiSectorSortState.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });

    sectorTable.innerHTML = sortedSectors.map(sector => `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
            <td class="p-2 text-gray-800">${sector.name}</td>
            <td class="p-2 text-right font-semibold text-green-600">${sector.count}</td>
            <td class="p-2 text-right text-gray-600">₹${Number(sector.amount).toFixed(2)}</td>
        </tr>
    `).join('') || '<tr><td colspan="3" class="p-4 text-center text-gray-500">No data available</td></tr>';
}

/**
 * Create ugrai payment methods bar chart
 */
function createUgraiPaymentMethodsChart(paymentMethods) {
    const canvas = document.getElementById('ugrai-payment-methods-chart');
    if (!canvas) return;

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    // UGRAI only has these 4 payment methods (no Credit, Cancelled, Returned)
    const UGRAI_PAYMENT_METHODS = ['Cash', 'Cheque', 'NEFT', 'UPI'];
    const labels = UGRAI_PAYMENT_METHODS;
    const data = labels.map(method => paymentMethods[method]?.count || 0);
    const amounts = labels.map(method => paymentMethods[method]?.amount || 0);

    console.log('📊 UGRAI Chart Data:', { labels, data, amounts, paymentMethods });

    canvas.chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Number of Ugrai',
                data: data,
                backgroundColor: [
                    'rgba(34, 197, 94, 0.7)',   // Green - Cash
                    'rgba(245, 158, 11, 0.7)',  // Yellow - Cheque
                    'rgba(139, 92, 246, 0.7)',  // Purple - NEFT
                    'rgba(59, 130, 246, 0.7)',  // Blue - UPI
                ],
                borderColor: [
                    'rgba(34, 197, 94, 1)',
                    'rgba(245, 158, 11, 1)',
                    'rgba(139, 92, 246, 1)',
                    'rgba(59, 130, 246, 1)',
                ],
                borderWidth: 2,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        afterLabel: function (context) {
                            const paymentMethod = labels[context.dataIndex];
                            const amount = amounts[context.dataIndex];
                            return `Amount: ₹${amount.toLocaleString()}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    },
                    title: {
                        display: true,
                        text: 'Number of Ugrai'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Payment Method'
                    }
                }
            }
        }
    });
}

/**
 * Create ugrai sector analysis doughnut chart
 */
function createUgraiSectorChart(sectors) {
    const canvas = document.getElementById('ugrai-sector-chart');
    if (!canvas) return;

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    if (sectors.length === 0) {
        // Show "No data" message
        ctx.font = '16px Arial';
        ctx.fillStyle = '#6B7280';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        return;
    }

    const labels = sectors.map(s => s.name);
    const data = sectors.map(s => s.amount);

    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgba(34, 197, 94, 0.8)',   // Green
                    'rgba(16, 185, 129, 0.8)',  // Emerald
                    'rgba(245, 158, 11, 0.8)',  // Yellow
                    'rgba(239, 68, 68, 0.8)',   // Red
                    'rgba(139, 92, 246, 0.8)',  // Purple
                    'rgba(6, 182, 212, 0.8)',   // Cyan
                    'rgba(236, 72, 153, 0.8)',  // Pink
                    'rgba(59, 130, 246, 0.8)',  // Blue
                ],
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const sector = sectors[context.dataIndex];
                            const total = sectors.reduce((sum, s) => sum + s.amount, 0);
                            const percentage = total > 0 ? ((sector.amount / total) * 100).toFixed(1) : 0;
                            return [
                                `${sector.name}: ₹${sector.amount.toLocaleString()}`,
                                `${percentage}% of total amount`,
                                `${sector.count} ugrai`
                            ];
                        }
                    }
                }
            }
        }
    });
}

/**
 * Handle ugrai date range selection
 */
function handleUgraiDateRangeSelection() {
    const quickDateSelect = document.getElementById('ugrai-analysis-quick-date');
    const fromDateInput = document.getElementById('ugrai-analysis-from-date');
    const toDateInput = document.getElementById('ugrai-analysis-to-date');

    if (!quickDateSelect || !fromDateInput || !toDateInput) return;

    const today = new Date();
    const value = quickDateSelect.value;

    let fromDate = null;
    let toDate = null;

    switch (value) {
        case 'today':
            fromDate = toDate = today.toISOString().split('T')[0];
            break;
        case 'week':
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            fromDate = weekStart.toISOString().split('T')[0];
            toDate = today.toISOString().split('T')[0];
            break;
        case 'month':
            fromDate = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
            toDate = today.toISOString().split('T')[0];
            break;
        case 'quarter':
            const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
            fromDate = quarterStart.toISOString().split('T')[0];
            toDate = today.toISOString().split('T')[0];
            break;
        case 'year':
            fromDate = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
            toDate = today.toISOString().split('T')[0];
            break;
        case 'all':
            fromDate = toDate = null;
            break;
        default:
            // Custom range - don't change the date inputs
            return;
    }

    fromDateInput.value = fromDate || '';
    toDateInput.value = toDate || '';
}

// ==============================
// DETAILED UGRAI FUNCTIONS
// ==============================

// Detailed ugrai state management
let detailedUgraiData = [];
let filteredDetailedUgrai = [];
let detailedUgraiCurrentPage = 1;
const detailedUgraiPerPage = 20;
let detailedUgraiSortField = 'completion_date';
let detailedUgraiSortOrder = 'desc';

/**
 * Fetch all ugrai transactions for detailed view
 */
async function fetchAllUgrai(fromDate = null, toDate = null) {
    try {
        console.log('🔍 Fetching all ugrai for detailed view...');

        if (!appState.supabaseService) {
            console.error('SupabaseService not available');
            return [];
        }

        // Fetch all ugrai data from different sources
        let allUgrai = [];
        const processedUgraiNumbers = new Set();

        // Get approved ugrai (this is likely where your 9 bills are)
        console.log('📊 Detailed view: Fetching approved ugrai...');
        const approvedUgrai = await appState.supabaseService.getAllApprovedUgrai() || [];
        console.log(`📊 Detailed view: Found ${approvedUgrai.length} approved ugrai transactions`);

        // Debug: Show first few records to check date fields
        if (approvedUgrai.length > 0) {
            console.log('📊 Detailed view: Sample approved ugrai record:', {
                billNumber: approvedUgrai[0].billNumber,
                dateApproved: approvedUgrai[0].dateApproved,
                date_approved: approvedUgrai[0].date_approved,
                billDate: approvedUgrai[0].billDate,
                bill_date: approvedUgrai[0].bill_date,
                allDateFields: Object.keys(approvedUgrai[0]).filter(key => key.toLowerCase().includes('date'))
            });
        }

        approvedUgrai.forEach(ugrai => {
            // Map approved ugrai fields to expected format
            const mappedUgrai = {
                ...ugrai,
                ugrai_number: ugrai.billNumber || ugrai.bill_number,
                ugraiNumber: ugrai.billNumber || ugrai.bill_number,
                completion_date: ugrai.dateApproved || ugrai.date_approved || ugrai.billDate || ugrai.bill_date,
                completionDate: ugrai.dateApproved || ugrai.date_approved || ugrai.billDate || ugrai.bill_date,
                retailer_name: ugrai.retailerName,
                retailerName: ugrai.retailerName,
                net_amount: ugrai.netAmount,
                netAmount: ugrai.netAmount,
                received_amount: ugrai.receivedAmount,
                receivedAmount: ugrai.receivedAmount,
                payment_method: ugrai.paymentMethod,
                paymentMethod: ugrai.paymentMethod,
                status: 'approved'
            };

            const ugraiNumber = mappedUgrai.ugrai_number || mappedUgrai.ugraiNumber;
            if (ugraiNumber && !processedUgraiNumbers.has(ugraiNumber)) {
                processedUgraiNumbers.add(ugraiNumber);
                allUgrai.push(mappedUgrai);
            }
        });

        // Get completed ugrai (might be different from approved)
        console.log('📊 Fetching completed ugrai...');
        const completedUgrai = await fetchCompletedUgrai(fromDate, toDate) || [];
        console.log(`📊 Found ${completedUgrai.length} completed ugrai transactions`);

        completedUgrai.forEach(ugrai => {
            ugrai.status = ugrai.status || 'completed';
            const ugraiNumber = ugrai.ugrai_number || ugrai.ugraiNumber;
            if (ugraiNumber && !processedUgraiNumbers.has(ugraiNumber)) {
                processedUgraiNumbers.add(ugraiNumber);
                allUgrai.push(ugrai);
            }
        });

        // Get in-progress ugrai if available
        try {
            console.log('📊 Fetching in-progress ugrai...');
            const inProgressUgrai = await appState.supabaseService.getUgraiInProgress() || [];
            console.log(`📊 Found ${inProgressUgrai.length} in-progress ugrai transactions`);

            inProgressUgrai.forEach(ugrai => {
                // Map in-progress ugrai fields to expected format
                const mappedUgrai = {
                    ...ugrai,
                    ugrai_number: ugrai.billNumber || ugrai.bill_number,
                    ugraiNumber: ugrai.billNumber || ugrai.bill_number,
                    completion_date: ugrai.created_at || ugrai.createdAt,
                    completionDate: ugrai.created_at || ugrai.createdAt,
                    retailer_name: ugrai.retailerName,
                    retailerName: ugrai.retailerName,
                    net_amount: ugrai.netAmount,
                    netAmount: ugrai.netAmount,
                    received_amount: ugrai.receivedAmount,
                    receivedAmount: ugrai.receivedAmount,
                    payment_method: ugrai.paymentMethod,
                    paymentMethod: ugrai.paymentMethod,
                    status: ugrai.status || 'pending'
                };

                const ugraiNumber = mappedUgrai.ugrai_number || mappedUgrai.ugraiNumber;
                if (ugraiNumber && !processedUgraiNumbers.has(ugraiNumber)) {
                    processedUgraiNumbers.add(ugraiNumber);
                    allUgrai.push(mappedUgrai);
                }
            });
        } catch (error) {
            console.warn('Could not fetch in-progress ugrai:', error);
        }

        console.log(`📊 Total unique ugrai transactions found: ${allUgrai.length}`);

        // Apply date filtering if specified
        if (fromDate || toDate) {
            const originalLength = allUgrai.length;
            allUgrai = allUgrai.filter(ugrai => {
                // Try multiple possible date field names including approved ugrai fields
                const ugraiDate = new Date(
                    ugrai.completion_date ||
                    ugrai.date_approved ||
                    ugrai.dateApproved ||
                    ugrai.completionDate ||
                    ugrai.billDate ||
                    ugrai.bill_date ||
                    ugrai.dateCompleted ||
                    ugrai.date_completed ||
                    ugrai.completedDate ||
                    ugrai.completed_date ||
                    ugrai.createdAt ||
                    ugrai.created_at
                );

                // Debug the date filtering for small datasets
                if (originalLength <= 15) {
                    console.log(`🔍 Detailed view ugrai ${ugrai.billNumber || ugrai.ugrai_number || ugrai.id}: date=${ugraiDate.toISOString()}, fromDate=${fromDate}, toDate=${toDate}, passing=${!(fromDate && ugraiDate < new Date(fromDate)) && !(toDate && ugraiDate > new Date(toDate + 'T23:59:59'))}`);
                }

                if (fromDate && ugraiDate < new Date(fromDate)) return false;
                if (toDate && ugraiDate > new Date(toDate + 'T23:59:59')) return false;
                return true;
            });
            console.log(`📅 Detailed view after date filtering: ${allUgrai.length} ugrai transactions (filtered out ${originalLength - allUgrai.length})`);
        }

        return allUgrai;

    } catch (error) {
        console.error('❌ Error fetching all ugrai:', error);
        return [];
    }
}

/**
 * Load and display detailed ugrai
 */
async function loadDetailedUgrai(fromDate = null, toDate = null) {
    try {
        console.log('📋 Loading detailed ugrai...');
        console.log('📊 Fetching from ALL sources (Pending, In Progress, Processed, Approved)');

        // Fetch ALL ugrai bills from all sources
        detailedUgraiData = await fetchAllUgraiBills(fromDate, toDate);
        console.log(`📊 Detailed ugrai fetched: ${detailedUgraiData.length} records`);

        // Initialize filtered ugrai
        filteredDetailedUgrai = [...detailedUgraiData];
        console.log(`📊 Detailed ugrai after initialization: ${filteredDetailedUgrai.length} records`);

        // Update status tab counts
        updateStatusTabCounts();

        // Populate sector filter dropdown
        populateDetailedUgraiSectorFilter();

        // Apply initial sort
        sortDetailedUgrai(detailedUgraiSortField, false);
        console.log(`📊 Detailed ugrai after initial sort: ${filteredDetailedUgrai.length} records`);

        // Display ugrai
        displayDetailedUgrai();

        console.log('✅ Detailed ugrai loaded successfully');
        console.log('📊 Detailed ugrai debug info:', {
            totalUgraiData: detailedUgraiData.length,
            filteredUgrai: filteredDetailedUgrai.length,
            statusBreakdown: {
                pending: detailedUgraiData.filter(u => u.status === 'Pending').length,
                inProgress: detailedUgraiData.filter(u => u.status === 'In Progress').length,
                processed: detailedUgraiData.filter(u => u.status === 'Processed').length,
                approved: detailedUgraiData.filter(u => u.status === 'Approved').length
            },
            currentPage: detailedUgraiCurrentPage,
            perPage: detailedUgraiPerPage
        });

    } catch (error) {
        console.error('❌ Error loading detailed ugrai:', error);
    }
}

/**
 * Populate sector filter dropdown
 */
function populateDetailedUgraiSectorFilter() {
    const sectorFilter = document.getElementById('detailed-ugrai-sector-filter');
    if (!sectorFilter) return;

    // Get unique sectors
    const sectors = [...new Set(detailedUgraiData.map(ugrai =>
        ugrai.sector || ugrai.Sector || 'Unknown'
    ))].sort();

    // Clear existing options except first
    sectorFilter.innerHTML = '<option value="">All Sectors</option>';

    // Add sector options
    sectors.forEach(sector => {
        const option = document.createElement('option');
        option.value = sector;
        option.textContent = sector;
        sectorFilter.appendChild(option);
    });
}

/**
 * Get payment method for ugrai with proper fallback
 */
function getUgraiPaymentMethod(ugrai) {
    // Check various payment method field names
    let paymentMethod = ugrai.paymentMethod || ugrai.payment_method || ugrai.PaymentMethod || ugrai.Payment_Method || ugrai.payment_type || ugrai.paymentType;

    // If payment method is empty, null, or "N/A", try to infer from other fields
    if (!paymentMethod || paymentMethod === '' || paymentMethod.toLowerCase() === 'n/a' || paymentMethod.toLowerCase() === 'null') {
        // Try to infer from related fields
        if (ugrai.upi_id || ugrai.upiId || ugrai.UPI_ID || ugrai.upi_transaction_id) {
            return 'UPI';
        }
        if (ugrai.cheque_number || ugrai.chequeNumber || ugrai.Cheque_Number || ugrai.cheque_no) {
            return 'Cheque';
        }
        if (ugrai.bank_name || ugrai.bankName || ugrai.Bank_Name || ugrai.neft_details || ugrai.account_number) {
            return 'NEFT';
        }
        // Default fallback
        return 'Cash';
    }

    // Normalize payment method names
    const normalizedMethod = paymentMethod.toString().toLowerCase();
    if (normalizedMethod.includes('upi')) return 'UPI';
    if (normalizedMethod.includes('cheque') || normalizedMethod.includes('check')) return 'Cheque';
    if (normalizedMethod.includes('neft') || normalizedMethod.includes('bank') || normalizedMethod.includes('transfer')) return 'NEFT';
    if (normalizedMethod.includes('cash')) return 'Cash';

    // Return as-is if it's a recognized method
    const recognizedMethods = ['Cash', 'UPI', 'Cheque', 'NEFT'];
    const exactMatch = recognizedMethods.find(method => method.toLowerCase() === normalizedMethod);
    if (exactMatch) return exactMatch;

    // Return capitalized version of the payment method
    return paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1).toLowerCase();
}

/**
 * Update status tab counts
 */
function updateStatusTabCounts() {
    if (!detailedUgraiData) return;

    const counts = {
        all: detailedUgraiData.length,
        pending: detailedUgraiData.filter(u => u.status === 'Pending').length,
        inprogress: detailedUgraiData.filter(u => u.status === 'In Progress').length,
        completed: detailedUgraiData.filter(u => u.status === 'Completed').length,
        processed: detailedUgraiData.filter(u => u.status === 'Processed').length,
        approved: detailedUgraiData.filter(u => u.status === 'Approved').length
    };

    // Update count badges
    const allCount = document.getElementById('status-count-all');
    const pendingCount = document.getElementById('status-count-pending');
    const inProgressCount = document.getElementById('status-count-inprogress');
    const completedCount = document.getElementById('status-count-completed');
    const processedCount = document.getElementById('status-count-processed');
    const approvedCount = document.getElementById('status-count-approved');

    if (allCount) allCount.textContent = counts.all;
    if (pendingCount) pendingCount.textContent = counts.pending;
    if (inProgressCount) inProgressCount.textContent = counts.inprogress;
    if (completedCount) completedCount.textContent = counts.completed;
    if (processedCount) processedCount.textContent = counts.processed;
    if (approvedCount) approvedCount.textContent = counts.approved;

    console.log('📊 Status tab counts updated:', counts);
}

/**
 * Display detailed ugrai in table
 */
function displayDetailedUgrai() {
    const tbody = document.getElementById('detailed-ugrai-table-body');
    if (!tbody) return;

    // Calculate pagination
    const totalUgrai = filteredDetailedUgrai.length;
    const startIndex = (detailedUgraiCurrentPage - 1) * detailedUgraiPerPage;
    const endIndex = Math.min(startIndex + detailedUgraiPerPage, totalUgrai);
    const pagesUgrai = filteredDetailedUgrai.slice(startIndex, endIndex);

    console.log(`📊 Display detailed ugrai - Total: ${totalUgrai}, Page: ${detailedUgraiCurrentPage}, Showing: ${pagesUgrai.length} records`);

    // Clear existing content
    tbody.innerHTML = '';

    if (pagesUgrai.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-gray-500">
                    <div class="flex flex-col items-center gap-2">
                        <span class="text-2xl">📄</span>
                        <span>No ugrai transactions found matching the current filters</span>
                    </div>
                </td>
            </tr>
        `;
        updateDetailedUgraiPagination(0, 0, 0);
        return;
    }

    // Populate rows
    pagesUgrai.forEach(ugrai => {
        const row = document.createElement('tr');
        row.className = 'border-b border-gray-100 hover:bg-gray-50';

        // Format dates - check multiple possible date fields
        const ugraiDate = new Date(
            ugrai.completion_date ||
            ugrai.completionDate ||
            ugrai.date_approved ||
            ugrai.dateApproved ||
            ugrai.bill_date ||
            ugrai.billDate ||
            ugrai.createdAt ||
            ugrai.created_at
        );
        const formattedDate = ugraiDate.toLocaleDateString('en-IN');

        // Get amounts - check multiple field variations
        const netAmount = parseFloat(
            ugrai.net_amount ||
            ugrai.netAmount ||
            ugrai.Net_Amount ||
            0
        );
        const receivedAmount = parseFloat(
            ugrai.received_amount ||
            ugrai.receivedAmount ||
            ugrai.Received_Amount ||
            0
        );

        // Get status with proper styling
        const status = ugrai.status || 'Pending';
        const isPartialPayment = ugrai.isPartialPayment || false;
        let statusBadge = '';

        switch (status) {
            case 'Approved':
                statusBadge = '<span class="px-2 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full">✅ Approved</span>';
                break;
            case 'Processed':
                if (isPartialPayment) {
                    statusBadge = '<span class="px-2 py-1 bg-indigo-100 text-indigo-800 text-xs font-semibold rounded-full">🔵 Processed (Partial)</span>';
                } else {
                    statusBadge = '<span class="px-2 py-1 bg-indigo-100 text-indigo-800 text-xs font-semibold rounded-full">🔵 Processed</span>';
                }
                break;
            case 'Completed':
                // Bills with 'Completed' status (from appState.data.completedUgrai with their original status)
                if (isPartialPayment) {
                    statusBadge = '<span class="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">🟣 Completed (Partial)</span>';
                } else {
                    statusBadge = '<span class="px-2 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">🟣 Completed</span>';
                }
                break;
            case 'In Progress':
                statusBadge = `<span class="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">🔄 In Progress${ugrai.assignedTo ? ' (' + ugrai.assignedTo + ')' : ''}</span>`;
                break;
            case 'Pending':
                statusBadge = '<span class="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-semibold rounded-full">⏳ Pending</span>';
                break;
            default:
                statusBadge = `<span class="px-2 py-1 bg-gray-100 text-gray-800 text-xs font-semibold rounded-full">${status}</span>`;
                break;
        }

        row.innerHTML = `
            <td class="p-3 font-mono text-sm">${ugrai.ugrai_number || ugrai.ugraiNumber || ugrai.billNumber || ugrai.bill_number || 'N/A'}</td>
            <td class="p-3">${formattedDate}</td>
            <td class="p-3">${ugrai.retailer_name || ugrai.retailerName || ugrai.Retailer_Name || 'N/A'}</td>
            <td class="p-3">${ugrai.sector || ugrai.Sector || 'Unknown'}</td>
            <td class="p-3 text-right font-semibold">₹${netAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
            <td class="p-3 text-right font-semibold">₹${receivedAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
            <td class="p-3">${getUgraiPaymentMethod(ugrai)}</td>
            <td class="p-3 text-center">${statusBadge}</td>
        `;

        tbody.appendChild(row);
    });

    // Update pagination info
    updateDetailedUgraiPagination(startIndex + 1, endIndex, totalUgrai);
}

/**
 * Update pagination controls
 */
function updateDetailedUgraiPagination(start, end, total) {
    const startSpan = document.getElementById('detailed-ugrai-showing-start');
    const endSpan = document.getElementById('detailed-ugrai-showing-end');
    const totalSpan = document.getElementById('detailed-ugrai-total');
    const pageInfo = document.getElementById('detailed-ugrai-page-info');
    const prevBtn = document.getElementById('detailed-ugrai-prev-page');
    const nextBtn = document.getElementById('detailed-ugrai-next-page');

    if (startSpan) startSpan.textContent = start;
    if (endSpan) endSpan.textContent = end;
    if (totalSpan) totalSpan.textContent = total;

    const totalPages = Math.ceil(total / detailedUgraiPerPage);
    if (pageInfo) pageInfo.textContent = `Page ${detailedUgraiCurrentPage} of ${totalPages}`;

    if (prevBtn) {
        prevBtn.disabled = detailedUgraiCurrentPage <= 1;
        prevBtn.onclick = () => {
            if (detailedUgraiCurrentPage > 1) {
                detailedUgraiCurrentPage--;
                displayDetailedUgrai();
            }
        };
    }

    if (nextBtn) {
        nextBtn.disabled = detailedUgraiCurrentPage >= totalPages;
        nextBtn.onclick = () => {
            if (detailedUgraiCurrentPage < totalPages) {
                detailedUgraiCurrentPage++;
                displayDetailedUgrai();
            }
        };
    }
}

/**
 * Sort detailed ugrai
 */
function sortDetailedUgrai(field, toggleOrder = true) {
    if (toggleOrder && detailedUgraiSortField === field) {
        detailedUgraiSortOrder = detailedUgraiSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        detailedUgraiSortField = field;
        detailedUgraiSortOrder = 'asc';
    }

    filteredDetailedUgrai.sort((a, b) => {
        let aVal, bVal;

        switch (field) {
            case 'ugrai_number':
                aVal = a.ugrai_number || a.ugraiNumber || a.billNumber || a.bill_number || '';
                bVal = b.ugrai_number || b.ugraiNumber || b.billNumber || b.bill_number || '';
                break;
            case 'completion_date':
                aVal = new Date(a.completion_date || a.completionDate || a.date_approved || a.dateApproved || a.bill_date || a.billDate || a.createdAt || a.created_at);
                bVal = new Date(b.completion_date || b.completionDate || b.date_approved || b.dateApproved || b.bill_date || b.billDate || b.createdAt || b.created_at);
                break;
            case 'retailer_name':
                aVal = a.retailer_name || a.retailerName || a.Retailer_Name || '';
                bVal = b.retailer_name || b.retailerName || b.Retailer_Name || '';
                break;
            case 'sector':
                aVal = a.sector || a.Sector || '';
                bVal = b.sector || b.Sector || '';
                break;
            case 'net_amount':
                aVal = parseFloat(a.net_amount || a.netAmount || a.Net_Amount || 0);
                bVal = parseFloat(b.net_amount || b.netAmount || b.Net_Amount || 0);
                break;
            case 'received_amount':
                aVal = parseFloat(a.received_amount || a.receivedAmount || a.Received_Amount || 0);
                bVal = parseFloat(b.received_amount || b.receivedAmount || b.Received_Amount || 0);
                break;
            case 'payment_method':
                aVal = getUgraiPaymentMethod(a);
                bVal = getUgraiPaymentMethod(b);
                break;
            case 'status':
                aVal = a.status || 'completed';
                bVal = b.status || 'completed';
                break;
            default:
                return 0;
        }

        if (aVal === bVal) return 0;

        const comparison = aVal < bVal ? -1 : 1;
        return detailedUgraiSortOrder === 'asc' ? comparison : -comparison;
    });

    detailedUgraiCurrentPage = 1;
    displayDetailedUgrai();
}

/**
 * Filter detailed ugrai
 */
/**
 * Filter detailed ugrai by status from tabs
 */
function filterDetailedUgraiByStatus(status) {
    console.log('📊 Filtering by status:', status);

    if (!status || status === '') {
        // Show all bills
        filteredDetailedUgrai = [...detailedUgraiData];
        console.log(`📊 Showing ALL bills: ${filteredDetailedUgrai.length} total`);
    } else {
        // Filter by selected status
        filteredDetailedUgrai = detailedUgraiData.filter(ugrai => ugrai.status === status);

        // DEBUG: Show sample bills with this status
        console.log(`📊 Filtered to ${filteredDetailedUgrai.length} bills with status: ${status}`);
        if (filteredDetailedUgrai.length > 0 && filteredDetailedUgrai.length <= 10) {
            console.log(`🔍 Sample bills with status "${status}":`);
            filteredDetailedUgrai.forEach(bill => {
                console.log(`  - Bill #${bill.ugrai_number || bill.billNumber}: ${bill.retailer_name || bill.retailerName}`, {
                    source: bill._source,
                    reason: bill._statusReason,
                    amount: `₹${(bill.net_amount || bill.netAmount || 0).toLocaleString()}`
                });
            });
        } else if (filteredDetailedUgrai.length > 10) {
            console.log(`🔍 First 5 bills with status "${status}":`);
            filteredDetailedUgrai.slice(0, 5).forEach(bill => {
                console.log(`  - Bill #${bill.ugrai_number || bill.billNumber}: ${bill.retailer_name || bill.retailerName}`, {
                    source: bill._source,
                    reason: bill._statusReason
                });
            });
        }
    }

    // Reset to page 1 and display
    detailedUgraiCurrentPage = 1;
    displayDetailedUgrai();
}

function filterDetailedUgrai() {
    const searchTerm = document.getElementById('detailed-ugrai-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('detailed-ugrai-status-filter')?.value || '';
    const sectorFilter = document.getElementById('detailed-ugrai-sector-filter')?.value || '';

    console.log(`🔍 Filtering UGRAI bills - Search: "${searchTerm}", Status: "${statusFilter}", Sector: "${sectorFilter}"`);

    filteredDetailedUgrai = detailedUgraiData.filter(ugrai => {
        // Search filter
        if (searchTerm) {
            const searchFields = [
                ugrai.ugrai_number || ugrai.ugraiNumber || ugrai.billNumber || ugrai.bill_number || '',
                ugrai.retailer_name || ugrai.retailerName || ugrai.Retailer_Name || '',
                ugrai.sector || ugrai.Sector || ''
            ];

            const matchesSearch = searchFields.some(field =>
                field.toLowerCase().includes(searchTerm)
            );

            if (!matchesSearch) return false;

            // DEBUG: Log matching bills with their source and status reason
            console.log(`✅ Found match: Bill #${ugrai.ugrai_number || ugrai.billNumber}`, {
                retailer: ugrai.retailer_name || ugrai.retailerName,
                status: ugrai.status,
                source: ugrai._source,
                reason: ugrai._statusReason,
                sector: ugrai.sector,
                amount: `₹${(ugrai.net_amount || ugrai.netAmount || 0).toLocaleString()}`
            });
        }

        // Status filter
        if (statusFilter && (ugrai.status || 'completed') !== statusFilter) {
            return false;
        }

        // Sector filter
        if (sectorFilter && (ugrai.sector || ugrai.Sector || 'Unknown') !== sectorFilter) {
            return false;
        }

        return true;
    });

    console.log(`📊 Filter results: ${filteredDetailedUgrai.length} bills matched (from ${detailedUgraiData.length} total)`);

    detailedUgraiCurrentPage = 1;
    displayDetailedUgrai();
}

/**
 * Clear all filters
 */
function clearDetailedUgraiFilters() {
    document.getElementById('detailed-ugrai-search').value = '';
    document.getElementById('detailed-ugrai-sector-filter').value = '';

    // Reset status tabs to "All Bills"
    const statusTabBtns = document.querySelectorAll('.status-tab-btn');
    statusTabBtns.forEach(btn => {
        const status = btn.getAttribute('data-status');
        if (status === '') {
            // This is the "All Bills" tab
            btn.classList.add('active', 'border-green-600', 'text-green-700');
            btn.classList.remove('border-transparent', 'text-gray-600');
        } else {
            btn.classList.remove('active', 'border-green-600', 'text-green-700');
            btn.classList.add('border-transparent', 'text-gray-600');
        }
    });

    filteredDetailedUgrai = [...detailedUgraiData];
    detailedUgraiCurrentPage = 1;
    displayDetailedUgrai();
}

/**
 * Export detailed ugrai to CSV
 */
function exportDetailedUgraiCSV() {
    if (filteredDetailedUgrai.length === 0) {
        alert('No data to export');
        return;
    }

    const headers = ['Ugrai Number', 'Date', 'Retailer Name', 'Sector', 'Net Amount', 'Received Amount', 'Payment Method', 'Status'];
    const csvContent = [headers.join(',')];

    filteredDetailedUgrai.forEach(ugrai => {
        const row = [
            `"${ugrai.ugrai_number || ugrai.ugraiNumber || 'N/A'}"`,
            `"${new Date(ugrai.completion_date || ugrai.completionDate || ugrai.createdAt || ugrai.created_at).toLocaleDateString('en-IN')}"`,
            `"${ugrai.retailer_name || ugrai.retailerName || ugrai.Retailer_Name || 'N/A'}"`,
            `"${ugrai.sector || ugrai.Sector || 'Unknown'}"`,
            parseFloat(ugrai.net_amount || ugrai.netAmount || ugrai.Net_Amount || 0),
            parseFloat(ugrai.received_amount || ugrai.receivedAmount || ugrai.Received_Amount || 0),
            `"${getUgraiPaymentMethod(ugrai)}"`,
            `"${ugrai.status || 'completed'}"`
        ];
        csvContent.push(row.join(','));
    });

    const blob = new Blob([csvContent.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `detailed-ugrai-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

// Initialize detailed ugrai event listeners
document.addEventListener('DOMContentLoaded', function () {
    // Search input
    const searchInput = document.getElementById('detailed-ugrai-search');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(filterDetailedUgrai, 300));
    }

    // Filter dropdowns
    const statusFilter = document.getElementById('detailed-ugrai-status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', filterDetailedUgrai);
    }

    const sectorFilter = document.getElementById('detailed-ugrai-sector-filter');
    if (sectorFilter) {
        sectorFilter.addEventListener('change', filterDetailedUgrai);
    }

    // Status tab buttons
    const statusTabBtns = document.querySelectorAll('.status-tab-btn');
    statusTabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const selectedStatus = btn.getAttribute('data-status');

            // Update active tab
            statusTabBtns.forEach(b => {
                b.classList.remove('active', 'border-green-600', 'text-green-700');
                b.classList.add('border-transparent', 'text-gray-600');
            });
            btn.classList.add('active', 'border-green-600', 'text-green-700');
            btn.classList.remove('border-transparent', 'text-gray-600');

            // Filter by status
            filterDetailedUgraiByStatus(selectedStatus);
        });
    });

    // Clear filters button
    const clearFiltersBtn = document.getElementById('clear-detailed-ugrai-filters');
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', clearDetailedUgraiFilters);
    }

    // Export button
    const exportBtn = document.getElementById('export-detailed-ugrai');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportDetailedUgraiCSV);
    }
});

// Make functions available globally
window.sortDetailedUgrai = sortDetailedUgrai;

// ================================
// PURCHASE ANALYSIS FUNCTIONS
// ================================

/**
 * Load and display purchase analysis data
 */
async function loadPurchaseAnalysis(fromDate = null, toDate = null) {
    try {
        console.log('📊 Loading purchase analysis data...');
        showPurchaseLoadingState(true);

        // Get purchase data from app state
        const purchaseEntries = appState.data.purchaseEntries || [];
        const purchaseRetailers = appState.data.purchaseRetailers || [];

        console.log('📋 Purchase Analysis Data Summary:');
        console.log('  - Purchase Entries:', purchaseEntries.length);
        console.log('  - Purchase Retailers:', purchaseRetailers.length);

        // Show sample data for debugging
        if (purchaseEntries.length > 0) {
            console.log('📄 Sample Purchase Entry:', purchaseEntries[0]);
        }
        if (purchaseRetailers.length > 0) {
            console.log('🏪 Sample Purchase Retailer:', purchaseRetailers[0]);
        }

        // Filter by date range if provided
        let filteredEntries = purchaseEntries;
        if (fromDate && toDate) {
            filteredEntries = purchaseEntries.filter(entry => {
                const entryDate = new Date(entry.billDate);
                const from = new Date(fromDate);
                const to = new Date(toDate);
                return entryDate >= from && entryDate <= to;
            });
            console.log(`📅 Filtered to ${filteredEntries.length} entries between ${fromDate} and ${toDate}`);
        }

        // Calculate analysis data
        const analysisData = calculatePurchaseAnalysisData(filteredEntries);
        analysisData.fromDate = fromDate;
        analysisData.toDate = toDate;
        analysisData.dateRange = getPurchaseDateRangeText(fromDate, toDate);
        analysisData.rawData = {
            purchaseEntries: filteredEntries,
            purchaseRetailers: purchaseRetailers
        };

        console.log('📊 Calculated Analysis Data:', analysisData);

        // Update UI
        updatePurchaseAnalysisUI(analysisData);

        // Create charts
        createPurchasePaymentStatusChart(analysisData.statusData);
        createPurchaseMonthlyTrendChart(analysisData.monthlyData);

        showPurchaseLoadingState(false);
        console.log('✅ Purchase analysis loaded successfully');

    } catch (error) {
        console.error('❌ Error loading purchase analysis:', error);
        showPurchaseLoadingState(false);
    }
}

/**
 * Calculate purchase analysis data from entries
 */
function calculatePurchaseAnalysisData(entries) {
    console.log('🔍 Calculating purchase analysis data for', entries.length, 'entries');

    const data = {
        totalBills: entries.length,
        totalAmount: 0,
        statusData: {},
        retailerData: [],
        monthlyData: [],
        dueDateAnalysis: {
            overdue: 0,
            dueThisWeek: 0,
            dueThisMonth: 0,
            future: 0
        }
    };

    const retailers = {};
    const monthlyTotals = {};
    const statusTotals = {};
    const now = new Date();
    const oneWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const oneMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    entries.forEach(entry => {
        const amount = parseFloat(entry.netAmount) || 0;
        data.totalAmount += amount;

        // Status analysis
        const status = entry.status || 'Unknown';
        if (!statusTotals[status]) {
            statusTotals[status] = { status: status, count: 0, amount: 0 };
        }
        statusTotals[status].count++;
        statusTotals[status].amount += amount;

        // Retailer analysis
        const retailer = entry.retailerName || 'Unknown';
        if (!retailers[retailer]) {
            retailers[retailer] = { name: retailer, count: 0, amount: 0 };
        }
        retailers[retailer].count++;
        retailers[retailer].amount += amount;

        // Monthly analysis
        const entryDate = new Date(entry.billDate);
        const monthKey = `${entryDate.getFullYear()}-${(entryDate.getMonth() + 1).toString().padStart(2, '0')}`;
        if (!monthlyTotals[monthKey]) {
            monthlyTotals[monthKey] = { month: monthKey, amount: 0, count: 0 };
        }
        monthlyTotals[monthKey].amount += amount;
        monthlyTotals[monthKey].count++;

        // Due date analysis (for completed entries)
        if (entry.status === 'Completed') {
            const dueDate = calculateDueDate(entry);
            if (dueDate < now) {
                data.dueDateAnalysis.overdue += amount;
            } else if (dueDate <= oneWeek) {
                data.dueDateAnalysis.dueThisWeek += amount;
            } else if (dueDate <= oneMonth) {
                data.dueDateAnalysis.dueThisMonth += amount;
            } else {
                data.dueDateAnalysis.future += amount;
            }
        }
    });

    // Convert to arrays and sort
    data.statusData = Object.values(statusTotals);
    data.retailerData = Object.values(retailers).sort((a, b) => b.amount - a.amount);
    data.monthlyData = Object.values(monthlyTotals).sort((a, b) => a.month.localeCompare(b.month));

    console.log('📊 Purchase analysis calculated:', data);
    return data;
}

/**
 * Calculate due date for a purchase entry
 */
function calculateDueDate(entry) {
    const billDate = new Date(entry.billDate);

    // Find retailer due days
    const retailer = appState.data.purchaseRetailers.find(r =>
        r.retailerName === entry.retailerName
    );
    const dueDays = retailer ? retailer.dueDays : 30; // Default 30 days

    const dueDate = new Date(billDate);
    dueDate.setDate(billDate.getDate() + dueDays);
    return dueDate;
}

/**
 * Update purchase analysis UI with calculated data
 */
function updatePurchaseAnalysisUI(data) {
    console.log('🎨 Updating purchase analysis UI');

    // Update summary cards
    const totalBillsElement = document.getElementById('purchase-analysis-total-bills');
    const totalAmountElement = document.getElementById('purchase-analysis-total-amount');
    const dateRangeElement = document.getElementById('purchase-analysis-date-range');

    if (totalBillsElement) {
        totalBillsElement.textContent = data.totalBills.toLocaleString();
    }
    if (totalAmountElement) {
        totalAmountElement.textContent = `₹${data.totalAmount.toLocaleString()}`;
    }
    if (dateRangeElement) {
        dateRangeElement.textContent = data.dateRange;
    }

    // Update retailer analysis table
    updatePurchaseRetailerTable(data.retailerData);

    // Update status analysis table
    updatePurchaseStatusTable(data.statusData);

    // Update due dates analysis
    updatePurchaseDueDateAnalysis(data.dueDateAnalysis);

    // Update debug section with raw data
    updatePurchaseDebugSection(data.rawData);
}

/**
 * Show/hide purchase analysis loading state
 */
function showPurchaseLoadingState(show) {
    const loadingElement = document.getElementById('purchase-analysis-loading');
    const contentElement = document.getElementById('purchase-analysis-content');

    if (loadingElement && contentElement) {
        if (show) {
            loadingElement.classList.remove('hidden');
            contentElement.classList.add('opacity-50');
        } else {
            loadingElement.classList.add('hidden');
            contentElement.classList.remove('opacity-50');
        }
    }
}

/**
 * Update purchase retailer analysis table
 */
function updatePurchaseRetailerTable(retailers) {
    const retailerTable = document.getElementById('purchase-retailer-analysis-table');
    if (retailerTable) {
        retailerTable.innerHTML = retailers.slice(0, 10).map(retailer => `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-2 text-gray-800">${retailer.name}</td>
                <td class="p-2 text-right font-semibold text-purple-600">${retailer.count}</td>
                <td class="p-2 text-right text-gray-600">₹${retailer.amount.toLocaleString()}</td>
            </tr>
        `).join('') || '<tr><td colspan="3" class="p-4 text-center text-gray-500">No data available</td></tr>';
    }
}

/**
 * Update purchase status analysis table
 */
function updatePurchaseStatusTable(statusData) {
    const statusTable = document.getElementById('purchase-status-analysis-table');
    if (statusTable) {
        statusTable.innerHTML = statusData.map(statusItem => `
            <tr class="border-b border-gray-100 hover:bg-gray-50">
                <td class="p-2 text-gray-800">${statusItem.status || 'Unknown'}</td>
                <td class="p-2 text-right font-semibold text-purple-600">${statusItem.count}</td>
                <td class="p-2 text-right text-gray-600">₹${statusItem.amount.toLocaleString()}</td>
            </tr>
        `).join('') || '<tr><td colspan="3" class="p-4 text-center text-gray-500">No data available</td></tr>';
    }
}

/**
 * Update purchase due date analysis
 */
function updatePurchaseDueDateAnalysis(dueDateData) {
    const overdueElement = document.getElementById('purchase-overdue-amount');
    const dueWeekElement = document.getElementById('purchase-due-week-amount');
    const dueMonthElement = document.getElementById('purchase-due-month-amount');
    const futureElement = document.getElementById('purchase-future-amount');

    if (overdueElement) overdueElement.textContent = `₹${dueDateData.overdue.toLocaleString()}`;
    if (dueWeekElement) dueWeekElement.textContent = `₹${dueDateData.dueThisWeek.toLocaleString()}`;
    if (dueMonthElement) dueMonthElement.textContent = `₹${dueDateData.dueThisMonth.toLocaleString()}`;
    if (futureElement) futureElement.textContent = `₹${dueDateData.future.toLocaleString()}`;
}

/**
 * Create purchase payment status chart
 */
function createPurchasePaymentStatusChart(statusData) {
    const canvas = document.getElementById('purchase-payment-status-chart');
    if (!canvas) return;

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    if (statusData.length === 0) {
        // Show "No data" message
        ctx.font = '16px Arial';
        ctx.fillStyle = '#6B7280';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        return;
    }

    const labels = statusData.map(s => s.status || 'Unknown');
    const data = statusData.map(s => s.amount);

    canvas.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    'rgba(147, 51, 234, 0.8)',  // Purple
                    'rgba(16, 185, 129, 0.8)',  // Green
                    'rgba(239, 68, 68, 0.8)',   // Red
                    'rgba(245, 158, 11, 0.8)',  // Yellow
                    'rgba(59, 130, 246, 0.8)',  // Blue
                    'rgba(236, 72, 153, 0.8)',  // Pink
                ],
                borderColor: '#ffffff',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const status = statusData[context.dataIndex];
                            const total = statusData.reduce((sum, s) => sum + s.amount, 0);
                            const percentage = total > 0 ? ((status.amount / total) * 100).toFixed(1) : 0;
                            return [
                                `${status.status}: ₹${status.amount.toLocaleString()}`,
                                `${percentage}% of total amount`,
                                `${status.count} bills`
                            ];
                        }
                    }
                }
            }
        }
    });
}

/**
 * Create purchase monthly trend chart
 */
function createPurchaseMonthlyTrendChart(monthlyData) {
    const canvas = document.getElementById('purchase-monthly-trend-chart');
    if (!canvas) return;

    // Destroy existing chart if it exists
    if (canvas.chart) {
        canvas.chart.destroy();
    }

    const ctx = canvas.getContext('2d');

    if (monthlyData.length === 0) {
        // Show "No data" message
        ctx.font = '16px Arial';
        ctx.fillStyle = '#6B7280';
        ctx.textAlign = 'center';
        ctx.fillText('No data available', canvas.width / 2, canvas.height / 2);
        return;
    }

    const labels = monthlyData.map(m => {
        const [year, month] = m.month.split('-');
        return new Date(year, month - 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    });
    const data = monthlyData.map(m => m.amount);

    canvas.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Purchase Amount',
                data: data,
                borderColor: 'rgba(147, 51, 234, 1)',
                backgroundColor: 'rgba(147, 51, 234, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: 'rgba(147, 51, 234, 1)',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            const monthData = monthlyData[context.dataIndex];
                            return [
                                `Amount: ₹${monthData.amount.toLocaleString()}`,
                                `Bills: ${monthData.count}`
                            ];
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function (value) {
                            return '₹' + value.toLocaleString();
                        }
                    }
                }
            }
        }
    });
}

/**
 * Update purchase debug section with raw data
 */
function updatePurchaseDebugSection(rawData) {
    if (!rawData) return;

    const { purchaseEntries, purchaseRetailers } = rawData;

    // Update entry counts
    const entriesCountElement = document.getElementById('debug-purchase-entries-count');
    const retailersCountElement = document.getElementById('debug-purchase-retailers-count');

    if (entriesCountElement) {
        entriesCountElement.textContent = (purchaseEntries || []).length;
    }
    if (retailersCountElement) {
        retailersCountElement.textContent = (purchaseRetailers || []).length;
    }

    // Update purchase entries table
    const entriesTable = document.getElementById('debug-purchase-entries-table');
    if (entriesTable && purchaseEntries && purchaseEntries.length > 0) {
        entriesTable.innerHTML = purchaseEntries.map(entry => `
            <tr class="hover:bg-gray-50">
                <td class="border p-2">${entry.billNumber || 'N/A'}</td>
                <td class="border p-2">${entry.billDate || 'N/A'}</td>
                <td class="border p-2">${entry.retailerName || 'N/A'}</td>
                <td class="border p-2 text-right">₹${(entry.netAmount || 0).toLocaleString()}</td>
                <td class="border p-2">${entry.status || 'N/A'}</td>
            </tr>
        `).join('');
    } else if (entriesTable) {
        entriesTable.innerHTML = '<tr><td colspan="5" class="border p-2 text-center text-gray-500">No purchase entries found</td></tr>';
    }

    // Update purchase retailers table
    const retailersTable = document.getElementById('debug-purchase-retailers-table');
    if (retailersTable && purchaseRetailers && purchaseRetailers.length > 0) {
        retailersTable.innerHTML = purchaseRetailers.map(retailer => `
            <tr class="hover:bg-gray-50">
                <td class="border p-2">${retailer.retailerName || 'N/A'}</td>
                <td class="border p-2 text-right">${retailer.dueDays || 0} days</td>
            </tr>
        `).join('');
    } else if (retailersTable) {
        retailersTable.innerHTML = '<tr><td colspan="2" class="border p-2 text-center text-gray-500">No purchase retailers found</td></tr>';
    }
}

/**
 * Get date range text for purchase analysis
 */
function getPurchaseDateRangeText(fromDate, toDate) {
    if (!fromDate && !toDate) {
        return 'All purchase entries';
    }
    if (fromDate && toDate) {
        return `${fromDate} to ${toDate}`;
    }
    if (fromDate) {
        return `From ${fromDate}`;
    }
    if (toDate) {
        return `Until ${toDate}`;
    }
    return 'Custom date range';
}

/**
 * Handle purchase analysis date range selection
 */
function handlePurchaseDateRangeSelection() {
    const quickDateSelect = document.getElementById('purchase-analysis-quick-date');
    const fromDateInput = document.getElementById('purchase-analysis-from-date');
    const toDateInput = document.getElementById('purchase-analysis-to-date');

    if (!quickDateSelect || !fromDateInput || !toDateInput) return;

    const selectedValue = quickDateSelect.value;
    let fromDate = null;
    let toDate = null;

    const today = new Date();
    const formatDate = (date) => date.toISOString().split('T')[0];

    switch (selectedValue) {
        case 'today':
            fromDate = toDate = formatDate(today);
            break;
        case 'yesterday':
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            fromDate = toDate = formatDate(yesterday);
            break;
        case 'this-week':
            const weekStart = new Date(today);
            weekStart.setDate(today.getDate() - today.getDay());
            fromDate = formatDate(weekStart);
            toDate = formatDate(today);
            break;
        case 'last-week':
            const lastWeekEnd = new Date(today);
            lastWeekEnd.setDate(today.getDate() - today.getDay() - 1);
            const lastWeekStart = new Date(lastWeekEnd);
            lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
            fromDate = formatDate(lastWeekStart);
            toDate = formatDate(lastWeekEnd);
            break;
        case 'this-month':
            fromDate = formatDate(new Date(today.getFullYear(), today.getMonth(), 1));
            toDate = formatDate(today);
            break;
        case 'last-month':
            const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
            fromDate = formatDate(lastMonth);
            toDate = formatDate(lastMonthEnd);
            break;
        case 'this-quarter':
            const quarterStart = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
            fromDate = formatDate(quarterStart);
            toDate = formatDate(today);
            break;
        case 'this-year':
            fromDate = formatDate(new Date(today.getFullYear(), 0, 1));
            toDate = formatDate(today);
            break;
        case 'all':
            fromDate = toDate = null;
            break;
        case 'custom':
            // Don't change the date inputs for custom
            return;
    }
}

// Print Supplies in Progress Function
function printSuppliesInProgress() {
    try {
        console.log('🖨️ Preparing to print supplies in progress...');

        // Get current filtered supplies in progress data
        let suppliesInProgress = appState.data.activeSupplies.filter(bill =>
            bill.status === 'in_progress' || bill.status === 'In Progress'
        );

        // Apply current filters
        const supplyRetailerFilter = document.getElementById('supply-progress-retailer-filter');
        const supplyBillFilter = document.getElementById('supply-progress-bill-filter');
        const supplySectorFilter = document.getElementById('supply-progress-sector-filter');

        if (supplyRetailerFilter && supplyRetailerFilter.value.trim()) {
            const retailerSearchTerm = supplyRetailerFilter.value.toLowerCase();
            suppliesInProgress = suppliesInProgress.filter(bill =>
                bill.retailerName && bill.retailerName.toLowerCase().includes(retailerSearchTerm)
            );
        }

        if (supplyBillFilter && supplyBillFilter.value.trim()) {
            const billSearchTerm = supplyBillFilter.value.toLowerCase();
            suppliesInProgress = suppliesInProgress.filter(bill =>
                bill.billNumber && bill.billNumber.toLowerCase().includes(billSearchTerm)
            );
        }

        if (supplySectorFilter && supplySectorFilter.value.trim()) {
            const sectorSearchTerm = supplySectorFilter.value.toLowerCase();
            suppliesInProgress = suppliesInProgress.filter(bill =>
                bill.sector && bill.sector.toLowerCase().includes(sectorSearchTerm)
            );
        }

        if (suppliesInProgress.length === 0) {
            alert('No supplies in progress to print');
            return;
        }

        // Sort bills by sector first, then by retailer name
        suppliesInProgress.sort((a, b) => {
            const sectorA = (a.sector || 'Z').toLowerCase();
            const sectorB = (b.sector || 'Z').toLowerCase();

            if (sectorA !== sectorB) {
                return sectorA.localeCompare(sectorB);
            }

            const nameA = (a.retailerName || 'Z').toLowerCase();
            const nameB = (b.retailerName || 'Z').toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Calculate totals
        const totalBills = suppliesInProgress.length;

        // Group by sector for summary (count only, not amount)
        const sectorSummary = {};

        suppliesInProgress.forEach(bill => {
            const sector = bill.sector || 'N/A';

            sectorSummary[sector] = (sectorSummary[sector] || 0) + 1; // Count invoices, not amount
        });

        // Create print content
        const printContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Supplies in Progress Report</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #000; }
                    .print-header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #000; padding-bottom: 20px; }
                    .print-title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
                    .print-date { font-size: 14px; color: #666; }
                    .print-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    .print-table th, .print-table td { border: 1px solid #000; padding: 8px; text-align: left; font-size: 11px; }
                    .print-table th { background-color: #f0f0f0; font-weight: bold; }
                    .print-table tr:nth-child(even) { background-color: #f9f9f9; }
                    .print-summary { margin-top: 30px; padding: 15px; border: 1px solid #000; background-color: #f5f5f5; }
                    .print-summary h3 { margin-top: 0; font-size: 16px; }
                    .summary-row { display: flex; justify-content: space-between; margin: 5px 0; }
                    .print-footer { margin-top: 30px; text-align: center; font-size: 10px; color: #666; }
                    .filters-applied { margin-bottom: 20px; padding: 10px; background-color: #e8f4fd; border: 1px solid #bee5eb; }
                </style>
            </head>
            <body>
                <div class="print-header">
                    <div class="print-title">Supplies in Progress Report</div>
                    <div class="print-date">Generated on: ${new Date().toLocaleDateString('en-IN')} at ${new Date().toLocaleTimeString('en-IN')}</div>
                </div>
                
                ${getActiveFiltersHtml()}
                
                <table class="print-table">
                    <thead>
                        <tr>
                            <th>S.No.</th>
                            <th>Bill Number</th>
                            <th>Bill Date</th>
                            <th>Retailer Name</th>
                            <th>Sector</th>
                            <th>Net Amount (₹)</th>
                            <th>Supply Through</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${suppliesInProgress.map((bill, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${bill.billNumber || 'N/A'}</td>
                                <td>${bill.billDate || 'N/A'}</td>
                                <td>${bill.retailerName || 'N/A'}</td>
                                <td>${bill.sector || 'N/A'}</td>
                                <td>₹${parseFloat(bill.netAmount?.toString().replace(/[₹,]/g, '') || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td>${bill.supplyThrough || 'N/A'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                
                <div class="print-summary">
                    <h3>Summary</h3>
                    <div class="summary-row">
                        <strong>Total Bills:</strong>
                        <strong>${totalBills}</strong>
                    </div>
                    
                    <h4 style="margin-top: 20px; margin-bottom: 10px;">Sector-wise Invoice Count:</h4>
                    ${Object.entries(sectorSummary)
                .sort(([a], [b]) => a.localeCompare(b)) // Sort sectors alphabetically
                .map(([sector, count]) => `
                        <div class="summary-row">
                            <span>${sector}:</span>
                            <span>${count} invoice${count !== 1 ? 's' : ''}</span>
                        </div>
                    `).join('')}
                </div>
                
                <div class="print-footer">
                    <p>This report was generated from the DLS Supply Management System</p>
                    <p>For any queries, please contact the system administrator</p>
                </div>
            </body>
            </html>
        `;

        // Helper function to get active filters HTML
        function getActiveFiltersHtml() {
            const activeFilters = [];

            if (supplyRetailerFilter && supplyRetailerFilter.value.trim()) {
                activeFilters.push(`Retailer: "${supplyRetailerFilter.value}"`);
            }
            if (supplyBillFilter && supplyBillFilter.value.trim()) {
                activeFilters.push(`Bill Number: "${supplyBillFilter.value}"`);
            }
            if (supplySectorFilter && supplySectorFilter.value.trim()) {
                activeFilters.push(`Sector: "${supplySectorFilter.value}"`);
            }

            if (activeFilters.length > 0) {
                return `
                    <div class="filters-applied">
                        <strong>Filters Applied:</strong> ${activeFilters.join(', ')}
                    </div>
                `;
            }
            return '';
        }

        // Open print window
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();

        // Wait for content to load then print
        printWindow.onload = function () {
            printWindow.focus();
            printWindow.print();
        };

        console.log('✅ Print window opened successfully');

    } catch (error) {
        console.error('❌ Error printing supplies in progress:', error);
        alert('Error generating print preview. Please try again.');
    }
}

// Print Total Ugrai bills grouped by sector
async function printTotalUgraiBySector(selectedSectors = null) {
    try {
        console.log('📄 Generating Total Ugrai print by sector (SQL-based)...');

        // Use SQL-based function to get all pending bills
        let pendingBills = appState.data.processedTotalUgrai;

        // If not loaded yet, load it now using SQL function
        if (!pendingBills || pendingBills.length === 0) {
            console.log('⚠️ processedTotalUgrai not loaded, loading from SQL...');
            pendingBills = await loadProcessedTotalUgrai();
        }

        console.log(`✅ Loaded ${pendingBills.length} bills from SQL function for print`);

        if (pendingBills.length === 0) {
            alert('No pending UGRAI bills to print (all bills are fully paid or have no due amount)');
            return;
        }

        // Group bills by sector
        const billsBySector = {};
        pendingBills.forEach(bill => {
            const sector = bill.sector || 'Unassigned';
            if (!billsBySector[sector]) {
                billsBySector[sector] = [];
            }
            billsBySector[sector].push(bill);
        });

        // Sort sectors alphabetically and filter by selected sectors if provided
        let sortedSectors = Object.keys(billsBySector).sort();
        if (selectedSectors && selectedSectors.length > 0) {
            sortedSectors = sortedSectors.filter(sector => selectedSectors.includes(sector));
        }

        if (sortedSectors.length === 0) {
            alert('No bills found for selected sectors');
            return;
        }

        // Generate HTML for each sector on separate pages
        let printContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Total UGRAI Bills by Sector - ${new Date().toLocaleDateString()}</title>
                <style>
                    @media print {
                        @page {
                            size: A4 portrait;
                            margin: 15mm 5mm;
                        }
                        .page-break {
                            page-break-after: always;
                        }
                    }
                    
                    body {
                        font-family: Arial, sans-serif;
                        font-size: 11pt;
                        margin: 0;
                        padding: 6px;
                    }
                    
                    .sector-page {
                        width: 100%;
                        margin-bottom: 20px;
                    }
                    
                    .page-header {
                        text-align: center;
                        margin-bottom: 20px;
                        border-bottom: 2px solid #000;
                        padding-bottom: 15px;
                    }
                    
                    .page-header h1 {
                        margin: 0 0 8px 0;
                        color: #000;
                        font-size: 30pt;
                        font-weight: bold;
                    }
                    
                    .page-header h2 {
                        margin: 0 0 5px 0;
                        color: #000;
                        font-size: 22.5pt;
                        font-weight: bold;
                    }
                    
                    .page-header p {
                        margin: 3px 0;
                        color: #000;
                        font-size: 12.5pt;
                        font-weight: bold;
                    }
                    
                    table {
                        width: 100%;
                        border-collapse: separate;
                        border-spacing: 0;
                        margin: 20px 0;
                        background: white;
                        border: 2px solid #000;
                    }
                    
                    thead {
                        background-color: #fff;
                        color: #000;
                    }
                    
                    th {
                        padding: 6px 8px;
                        text-align: left;
                        font-weight: bold;
                        border-right: 1px solid #000;
                        border-bottom: 2px solid #000;
                        font-size: 12.5pt;
                        line-height: 1.2;
                    }
                    
                    th:last-child {
                        border-right: none;
                    }
                    
                    td {
                        padding: 5px 8px;
                        border-right: 1px solid #000;
                        border-bottom: 1px solid #000;
                        font-size: 10pt;
                        color: #000;
                        line-height: 1.2;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    
                    td:last-child {
                        border-right: none;
                    }
                    
                    tbody tr:last-child td {
                        border-bottom: none;
                    }
                    
                    tbody tr:nth-child(even) {
                        background-color: #fff;
                    }
                    
                    tbody tr:hover {
                        background-color: #fff;
                    }
                    
                    .summary-section {
                        margin-top: 20px;
                        padding: 15px;
                        background-color: #fff;
                        border: 2px solid #000;
                        border-radius: 5px;
                    }
                    
                    .summary-row {
                        display: flex;
                        justify-content: space-between;
                        padding: 5px 0;
                        font-weight: bold;
                        font-size: 12.5pt;
                        color: #000;
                    }
                    
                    .amount {
                        text-align: right;
                        font-family: 'Courier New', monospace;
                        font-weight: bold;
                        color: #000;
                    }
                    
                    .footer {
                        margin-top: 30px;
                        text-align: center;
                        font-size: 11.25pt;
                        color: #000;
                        border-top: 1px solid #000;
                        padding-top: 15px;
                        font-weight: bold;
                    }
                </style>
            </head>
            <body>
        `;

        // Generate a page for each sector
        sortedSectors.forEach((sector, index) => {
            const bills = billsBySector[sector];
            const totalBills = bills.length;
            const totalDueAmount = bills.reduce((sum, bill) => {
                // Use the pre-calculated dueAmount from payment history
                const dueAmount = parseFloat(bill.dueAmount || 0);
                return sum + dueAmount;
            }, 0);

            printContent += `
                <div class="sector-page ${index < sortedSectors.length - 1 ? 'page-break' : ''}">
                    <div class="page-header">
                        <h2>Sector: ${sector}</h2>
                        <p>Generated on: ${new Date().toLocaleString()} | Total Bills: ${totalBills} | Total Due Amount: ₹${totalDueAmount.toFixed(2)}</p>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 5%;">Sr. No.</th>
                                <th style="width: 13%;">Bill Number</th>
                                <th style="width: 10%;">Bill Date</th>
                                <th style="width: 29%">Retailer Name</th>
                                <th style="width: 12%;">Net Amount</th>
                                <th style="width: 12%;">Received</th>
                                <th style="width: 12%;">Due Amount</th>
                                <th style="width: 7%;">Notes</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            bills.forEach((bill, idx) => {
                const netAmount = parseFloat(bill.netAmount || bill.amount || 0);
                const receivedAmount = parseFloat(bill.receivedAmount || bill.received_amount || 0);
                // Use the pre-calculated dueAmount from payment history
                const dueAmount = parseFloat(bill.dueAmount !== undefined ? bill.dueAmount : (netAmount - receivedAmount));

                printContent += `
                    <tr>
                        <td style="text-align: center;">${idx + 1}</td>
                        <td>${bill.billNumber || 'N/A'}</td>
                        <td>${bill.billDate || 'N/A'}</td>
                        <td>${bill.retailerName || 'N/A'}</td>
                        <td class="amount">${netAmount.toFixed(2)}</td>
                        <td class="amount">${receivedAmount.toFixed(2)}</td>
                        <td class="amount">${dueAmount.toFixed(2)}</td>
                        <td style="text-align: center;">-</td>
                    </tr>
                `;
            });

            printContent += `
                        </tbody>
                    </table>
                    
                    
                </div>
            `;
        });

        printContent += `
            </body>
            </html>
        `;

        // Open print window
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();

        // Wait for content to load then print
        printWindow.onload = function () {
            printWindow.focus();
            printWindow.print();
        };

        console.log(`✅ Print window opened with ${sortedSectors.length} sectors`);

    } catch (error) {
        console.error('❌ Error printing Total UGRAI:', error);
        alert('Error generating print preview. Please try again.');
    }
}

// Show print sector selection modal
async function showPrintSectorModal() {
    const modal = document.getElementById('print-sector-modal');
    const checkboxList = document.getElementById('sector-checkbox-list');
    const printAllCheckbox = document.getElementById('print-all-sectors');

    if (!modal || !checkboxList) {
        console.error('❌ Modal elements not found');
        return;
    }

    console.log('📋 Opening sector selection modal...');

    // Reuse the same function that loads Total UGRAI data
    let pendingBills = appState.data.processedTotalUgrai;

    // If not loaded yet, load it now using the same function
    if (!pendingBills || pendingBills.length === 0) {
        console.log('⚠️ processedTotalUgrai not available, loading now...');
        pendingBills = await loadProcessedTotalUgrai();
    }

    console.log('📊 Pending bills for modal:', pendingBills.length);

    // Get all sectors from the current Total Ugrai data
    const sectors = new Set();
    const sectorCounts = new Map();

    pendingBills.forEach(bill => {
        if (bill.sector) {
            sectors.add(bill.sector);
            sectorCounts.set(bill.sector, (sectorCounts.get(bill.sector) || 0) + 1);
        }
    });

    console.log('🏢 Sectors found (including assigned sectors):', Array.from(sectors));

    // Clear existing checkboxes
    checkboxList.innerHTML = '';

    // Create checkbox for each sector with bill count
    const sortedSectors = Array.from(sectors).sort();
    sortedSectors.forEach(sector => {
        const billCount = sectorCounts.get(sector) || 0;
        const label = document.createElement('label');
        label.className = 'flex items-center p-2 rounded-lg cursor-pointer hover:bg-gray-50';
        label.innerHTML = `
            <input type="checkbox" class="sector-checkbox h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded" value="${sector}">
            <span class="ml-3 text-sm text-gray-700">${sector} (${billCount})</span>
        `;
        checkboxList.appendChild(label);
    });

    console.log('✅ Created checkboxes for', sortedSectors.length, 'sectors');

    // Reset checkboxes
    if (printAllCheckbox) {
        printAllCheckbox.checked = false;
    }
    document.querySelectorAll('.sector-checkbox').forEach(cb => cb.checked = false);

    // Show modal - remove hidden class and set display
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

// Hide print sector selection modal
function hidePrintSectorModal() {
    const modal = document.getElementById('print-sector-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
}

// Handle "Print All" checkbox
document.addEventListener('change', function (e) {
    if (e.target.id === 'print-all-sectors') {
        const isChecked = e.target.checked;
        document.querySelectorAll('.sector-checkbox').forEach(cb => {
            cb.checked = isChecked;
        });
    }

    // If a sector checkbox is unchecked, uncheck "Print All"
    if (e.target.classList.contains('sector-checkbox')) {
        const printAllCheckbox = document.getElementById('print-all-sectors');
        if (!e.target.checked && printAllCheckbox) {
            printAllCheckbox.checked = false;
        }

        // If all sector checkboxes are checked, check "Print All"
        const allChecked = Array.from(document.querySelectorAll('.sector-checkbox')).every(cb => cb.checked);
        if (allChecked && printAllCheckbox) {
            printAllCheckbox.checked = true;
        }
    }
});

// Handle modal buttons
document.addEventListener('click', async function (e) {
    // Cancel button
    if (e.target.id === 'cancel-print-btn') {
        hidePrintSectorModal();
    }

    // Confirm print button
    if (e.target.id === 'confirm-print-btn') {
        const selectedSectors = Array.from(document.querySelectorAll('.sector-checkbox:checked'))
            .map(cb => cb.value);

        if (selectedSectors.length === 0) {
            alert('Please select at least one sector to print.');
            return;
        }

        hidePrintSectorModal();
        await printTotalUgraiBySector(selectedSectors);
    }

    // Print button - show modal instead of printing directly
    const printBtn = e.target.closest('#print-total-ugrai-btn');
    if (printBtn) {
        console.log('🖨️ Print button clicked - opening sector selection modal');
        e.preventDefault();
        e.stopPropagation();
        showPrintSectorModal();
        return false;
    }
}, true); // Use capture phase


// ============================================================================
// CASH RECEIPT FEATURE
// ============================================================================

// DOM Elements
const cashReceiptElements = {
    // Containers
    container: null,
    section: null,
    content: null,
    loading: null,
    tableBody: null,

    // Date Filters
    fromDate: null,
    toDate: null,
    quickDate: null,
    applyFilterBtn: null,
    refreshBtn: null,

    // Status Filters
    statusFilters: null,

    // Statistics
    totalCount: null,
    totalAmount: null,
    pendingCount: null,
    dateRange: null,

    // Status Counts
    statusCountAll: null,
    statusCountPending: null,
    statusCountCompleted: null,

    // Pagination
    prevPageBtn: null,
    nextPageBtn: null,
    pageInfo: null,
    showingStart: null,
    showingEnd: null,
    totalRecords: null,

    // Export
    exportBtn: null,

    // Tab
    tab: null,

    // Multi-select & bulk actions
    selectAllCheckbox: null,
    bulkActionsBar: null,
    bulkCompleteBtn: null,
    bulkCancelBtn: null,
    selectedCountLabel: null,

    // Page size
    pageSizeSelect: null
};

// State
const cashReceiptState = {
    allPayments: [],
    filteredPayments: [],
    currentFilter: 'all',
    currentPage: 1,
    itemsPerPage: 25,
    sortColumn: null,
    sortDirection: 'asc',
    dateRange: {
        from: null,
        to: null
    },
    selectedPaymentIds: new Set()  // tracks checked rows by payment.id
};

// Loading guard to prevent concurrent calls
let isLoadingPayments = false;

// Show Cash Receipt Tab if User has Permission
function showCashReceiptTabIfAuthorized() {
    const cashReceiptTab = document.getElementById('cash-receipt-tab');
    if (!cashReceiptTab) {
        console.warn('⚠️ Cash Receipt tab element not found');
        return;
    }

    // Check if user has cash_receipt.view permission using RBAC service
    if (window.rbacService && window.rbacService.hasPermission('cash_receipt.view')) {
        cashReceiptTab.style.display = 'inline-block';
        console.log('✅ Cash Receipt tab shown (has cash_receipt.view permission)');
    } else {
        cashReceiptTab.style.display = 'none';
        console.log('⚠️ Cash Receipt tab hidden (no cash_receipt.view permission)');
    }
}

// Initialize Cash Receipt Dashboard
// Guard: event listeners are attached only once across tab re-activations
let cashReceiptListenersAttached = false;

async function initializeCashReceiptDashboard() {
    console.log('🏦 Initializing Cash Receipt Dashboard...');

    // Get DOM elements
    cashReceiptElements.container = document.getElementById('cash-receipt-dashboard-container');
    cashReceiptElements.section = document.getElementById('cash-receipt-section');
    cashReceiptElements.content = document.getElementById('cash-receipt-content');
    cashReceiptElements.loading = document.getElementById('cash-receipt-loading');
    cashReceiptElements.tableBody = document.getElementById('cash-receipt-table-body');

    // Critical: Verify section exists
    if (!cashReceiptElements.section) {
        console.error('❌ CRITICAL: cash-receipt-section element not found in DOM!');
        return;
    }

    // Force section to be visible (override any inline styles AND remove hidden class)
    cashReceiptElements.section.style.display = 'block';
    cashReceiptElements.section.classList.remove('hidden');
    console.log('✅ Cash receipt section set to visible');
    console.log('Section classes after init:', cashReceiptElements.section.className);
    console.log('Section display style:', cashReceiptElements.section.style.display);

    cashReceiptElements.fromDate = document.getElementById('cash-receipt-from-date');
    cashReceiptElements.toDate = document.getElementById('cash-receipt-to-date');
    cashReceiptElements.quickDate = document.getElementById('cash-receipt-quick-date');
    cashReceiptElements.applyFilterBtn = document.getElementById('apply-cash-receipt-filter');
    cashReceiptElements.refreshBtn = document.getElementById('refresh-cash-receipt-btn');

    cashReceiptElements.statusFilters = document.querySelectorAll('.cash-receipt-status-filter');

    cashReceiptElements.totalCount = document.getElementById('cash-receipt-total-count');
    cashReceiptElements.totalAmount = document.getElementById('cash-receipt-total-amount');
    cashReceiptElements.pendingCount = document.getElementById('cash-receipt-pending-count');
    cashReceiptElements.dateRange = document.getElementById('cash-receipt-date-range');

    cashReceiptElements.statusCountAll = document.getElementById('cr-status-count-all');
    cashReceiptElements.statusCountPending = document.getElementById('cr-status-count-pending');
    cashReceiptElements.statusCountCompleted = document.getElementById('cr-status-count-completed');

    cashReceiptElements.prevPageBtn = document.getElementById('cash-receipt-prev-page');
    cashReceiptElements.nextPageBtn = document.getElementById('cash-receipt-next-page');
    cashReceiptElements.pageInfo = document.getElementById('cash-receipt-page-info');
    cashReceiptElements.showingStart = document.getElementById('cash-receipt-showing-start');
    cashReceiptElements.showingEnd = document.getElementById('cash-receipt-showing-end');
    cashReceiptElements.totalRecords = document.getElementById('cash-receipt-total');

    cashReceiptElements.exportBtn = document.getElementById('export-cash-receipt-csv');
    cashReceiptElements.tab = document.getElementById('cash-receipt-tab');
    cashReceiptElements.selectAllCheckbox = document.getElementById('cr-select-all');
    cashReceiptElements.bulkActionsBar = document.getElementById('cr-bulk-actions');
    cashReceiptElements.bulkCompleteBtn = document.getElementById('cr-bulk-complete-btn');
    cashReceiptElements.bulkCancelBtn = document.getElementById('cr-bulk-cancel-btn');
    cashReceiptElements.selectedCountLabel = document.getElementById('cr-selected-count');
    cashReceiptElements.pageSizeSelect = document.getElementById('cr-page-size');

    // Log which elements were found
    console.log('📋 DOM Elements Status:');
    console.log('  - Container:', cashReceiptElements.container ? '✅' : '❌');
    console.log('  - Section:', cashReceiptElements.section ? '✅' : '❌');
    console.log('  - Table Body:', cashReceiptElements.tableBody ? '✅' : '❌');
    console.log('  - From Date:', cashReceiptElements.fromDate ? '✅' : '❌');
    console.log('  - To Date:', cashReceiptElements.toDate ? '✅' : '❌');

    // Check for critical missing elements
    const missingElements = [];
    if (!cashReceiptElements.tableBody) missingElements.push('cash-receipt-table-body');
    if (!cashReceiptElements.section) missingElements.push('cash-receipt-section');

    if (missingElements.length > 0) {
        console.error('❌ Missing critical elements:', missingElements);
        return;
    }

    // Security check: Verify user has cash_receipt.view permission
    // (Tab visibility is set on page load, but verify again for security)
    if (!window.rbacService || !window.rbacService.hasPermission('cash_receipt.view')) {
        console.warn('⚠️ Unauthorized access attempt to Cash Receipt dashboard');
        return;
    }

    // Set default date range and attach listeners only on first initialisation
    // (initializeCashReceiptDashboard is called every time the tab is clicked,
    //  so we must guard against stacking duplicate addEventListener calls)
    if (!cashReceiptListenersAttached) {
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);

        if (cashReceiptElements.fromDate) {
            cashReceiptElements.fromDate.value = formatDateForInput(thirtyDaysAgo);
        }
        if (cashReceiptElements.toDate) {
            cashReceiptElements.toDate.value = formatDateForInput(today);
        }

        setupCashReceiptEventListeners();
        cashReceiptListenersAttached = true;
        console.log('✅ Cash Receipt Dashboard initialised — listeners attached');
    } else {
        console.log('ℹ️ Cash Receipt Dashboard already initialised — skipping listener setup');
    }
}

// Setup Event Listeners
function setupCashReceiptEventListeners() {
    // Date filter controls
    if (cashReceiptElements.quickDate) {
        cashReceiptElements.quickDate.addEventListener('change', handleQuickDateSelect);
    }

    if (cashReceiptElements.applyFilterBtn) {
        cashReceiptElements.applyFilterBtn.addEventListener('click', loadCashPayments);
    }

    if (cashReceiptElements.refreshBtn) {
        cashReceiptElements.refreshBtn.addEventListener('click', loadCashPayments);
    }

    // Status filters
    if (cashReceiptElements.statusFilters) {
        cashReceiptElements.statusFilters.forEach(btn => {
            btn.addEventListener('click', handleStatusFilterClick);
        });
    }

    // Pagination
    if (cashReceiptElements.prevPageBtn) {
        cashReceiptElements.prevPageBtn.addEventListener('click', () => changePage(-1));
    }

    if (cashReceiptElements.nextPageBtn) {
        cashReceiptElements.nextPageBtn.addEventListener('click', () => changePage(1));
    }

    // Export
    if (cashReceiptElements.exportBtn) {
        cashReceiptElements.exportBtn.addEventListener('click', exportCashReceiptsToCSV);
    }

    // Search input
    const searchInput = document.getElementById('cash-receipt-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchCashReceipts(e.target.value);
        });
    }

    // Sortable column headers
    const sortableHeaders = document.querySelectorAll('#cash-receipt-section .sortable[data-column]');
    if (sortableHeaders) {
        sortableHeaders.forEach(header => {
            header.addEventListener('click', (e) => {
                const column = e.currentTarget.dataset.column;
                if (column) {
                    sortCashReceipts(column);
                }
            });
        });
    }

    // Select-all checkbox
    if (cashReceiptElements.selectAllCheckbox) {
        cashReceiptElements.selectAllCheckbox.addEventListener('change', (e) => {
            const checked = e.target.checked;
            const pageData = getCurrentPageData();
            if (checked) {
                pageData.forEach(p => cashReceiptState.selectedPaymentIds.add(p.id));
            } else {
                pageData.forEach(p => cashReceiptState.selectedPaymentIds.delete(p.id));
            }
            // Sync row checkboxes
            document.querySelectorAll('.cr-row-checkbox').forEach(cb => {
                cb.checked = checked;
            });
            updateBulkActionsBar();
        });
    }

    // Bulk complete button
    if (cashReceiptElements.bulkCompleteBtn) {
        cashReceiptElements.bulkCompleteBtn.addEventListener('click', handleBulkComplete);
    }

    // Bulk cancel (clear selection)
    if (cashReceiptElements.bulkCancelBtn) {
        cashReceiptElements.bulkCancelBtn.addEventListener('click', () => {
            cashReceiptState.selectedPaymentIds.clear();
            if (cashReceiptElements.selectAllCheckbox) {
                cashReceiptElements.selectAllCheckbox.checked = false;
            }
            document.querySelectorAll('.cr-row-checkbox').forEach(cb => {
                cb.checked = false;
            });
            updateBulkActionsBar();
        });
    }

    // Page-size selector
    if (cashReceiptElements.pageSizeSelect) {
        cashReceiptElements.pageSizeSelect.addEventListener('change', (e) => {
            cashReceiptState.itemsPerPage = parseInt(e.target.value, 10);
            cashReceiptState.currentPage = 1;
            cashReceiptState.selectedPaymentIds.clear();
            updateBulkActionsBar();
            renderCashReceiptsTable();
            updatePaginationControls();
        });
    }
}

// Handle Quick Date Selection
function handleQuickDateSelect(e) {
    const value = e.target.value;
    const today = new Date();
    let fromDate = null;
    let toDate = today;

    switch (value) {
        case 'today':
            fromDate = today;
            break;
        case 'week':
            fromDate = new Date();
            fromDate.setDate(today.getDate() - 7);
            break;
        case 'month':
            fromDate = new Date();
            fromDate.setMonth(today.getMonth() - 1);
            break;
        case 'quarter':
            fromDate = new Date();
            fromDate.setMonth(today.getMonth() - 3);
            break;
        case 'year':
            fromDate = new Date();
            fromDate.setFullYear(today.getFullYear() - 1);
            break;
        case 'all':
            fromDate = null;
            toDate = null;
            break;
        default:
            return;
    }

    if (cashReceiptElements.fromDate) {
        cashReceiptElements.fromDate.value = fromDate ? formatDateForInput(fromDate) : '';
    }
    if (cashReceiptElements.toDate) {
        cashReceiptElements.toDate.value = toDate ? formatDateForInput(toDate) : '';
    }
}

// Load Cash Payments
async function loadCashPayments() {
    // Prevent concurrent calls
    if (isLoadingPayments) {
        console.log('⏳ Already loading cash payments, skipping duplicate call');
        return;
    }

    isLoadingPayments = true;
    console.log('📊 Loading cash payments...');

    // Disable trigger buttons to prevent re-clicks during load
    const setLoadingButtons = (loading) => {
        [cashReceiptElements.applyFilterBtn, cashReceiptElements.refreshBtn].forEach(btn => {
            if (!btn) return;
            if (loading) {
                btn.disabled = true;
                btn.dataset.originalText = btn.textContent.trim();
                btn.innerHTML = '<span class="inline-flex items-center gap-2"><svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Loading...</span>';
            } else {
                btn.disabled = false;
                btn.textContent = btn.dataset.originalText || btn.textContent;
            }
        });
    };

    setLoadingButtons(true);

    // Verify DOM elements exist
    if (!cashReceiptElements.tableBody) {
        console.error('❌ Cash receipt table body not found! Re-initializing elements...');
        // Re-attempt element lookup before giving up
        cashReceiptElements.tableBody = document.getElementById('cash-receipt-table-body');
        if (!cashReceiptElements.tableBody) {
            console.error('❌ Table body still not found after retry. Aborting load.');
            isLoadingPayments = false;
            return;
        }
    }

    // Show loading state
    if (cashReceiptElements.loading) {
        cashReceiptElements.loading.classList.remove('hidden');
    }
    if (cashReceiptElements.content) {
        cashReceiptElements.content.style.opacity = '0.5';
    }

    try {
        const fromDate = cashReceiptElements.fromDate?.value || null;
        const toDate = cashReceiptElements.toDate?.value || null;

        console.log(`📅 Date range: ${fromDate} to ${toDate}`);

        // Store date range
        cashReceiptState.dateRange.from = fromDate;
        cashReceiptState.dateRange.to = toDate;

        // Fetch payments
        const payments = await appState.supabaseService.getAllCashPayments(fromDate, toDate);
        console.log(`✅ Loaded ${payments.length} cash payments`);

        if (!payments || payments.length === 0) {
            console.warn('⚠️ No cash payments found for the selected date range');
        }

        // Store in state
        cashReceiptState.allPayments = payments;
        cashReceiptState.currentPage = 1;

        console.log(`📦 State updated - Total payments: ${cashReceiptState.allPayments.length}`);

        // Apply current filter
        console.log(`🔍 Applying filter: ${cashReceiptState.currentFilter}`);
        applyStatusFilter(cashReceiptState.currentFilter);

        // Update statistics
        console.log('📈 Updating statistics...');
        updateCashReceiptStatistics();

        // Update date range display
        updateDateRangeDisplay(fromDate, toDate);

        console.log('✅ Cash payments loaded and rendered successfully');

        // Reset selection when data refreshes
        cashReceiptState.selectedPaymentIds.clear();
        updateBulkActionsBar();
        if (cashReceiptElements.selectAllCheckbox) {
            cashReceiptElements.selectAllCheckbox.checked = false;
        }

        // Final visibility check
        const section = document.getElementById('cash-receipt-section');
        const container = document.getElementById('cash-receipt-dashboard-container');
        const content = document.getElementById('cash-receipt-content');
        const tableBody = document.getElementById('cash-receipt-table-body');

        console.log('📊 Final Visibility Check:');
        console.log('  - Container classes:', container?.className);
        console.log('  - Container has "hidden":', container?.classList.contains('hidden'));
        console.log('  - Container computed display:', container ? window.getComputedStyle(container).display : 'N/A');
        console.log('  - Section display style:', section?.style.display);
        console.log('  - Section computed display:', section ? window.getComputedStyle(section).display : 'N/A');
        console.log('  - Content computed display:', content ? window.getComputedStyle(content).display : 'N/A');
        console.log('  - Content opacity:', content ? window.getComputedStyle(content).opacity : 'N/A');
        console.log('  - Table body rows:', tableBody?.children.length);
        console.log('  - Table body HTML length:', tableBody?.innerHTML.length);

        // Check if actually visible in viewport
        if (section) {
            const rect = section.getBoundingClientRect();
            console.log('  - Section position:', {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
                visible: rect.width > 0 && rect.height > 0
            });

            // Scroll into view if off-screen
            if (rect.top < 0 || rect.top > window.innerHeight) {
                console.log('⚠️ Section is off-screen, scrolling into view...');
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

        }

    } catch (error) {
        console.error('❌ Error loading cash payments:', error);
        console.error('Error stack:', error.stack);
    } finally {
        console.log('🔄 Finally block executing - resetting loading state...');

        // Hide loading state
        if (cashReceiptElements.loading) {
            cashReceiptElements.loading.classList.add('hidden');
        }

        // Force opacity reset with pointer events
        if (cashReceiptElements.content) {
            cashReceiptElements.content.style.opacity = '1';
            cashReceiptElements.content.style.pointerEvents = 'auto';
            console.log('✅ Opacity forcibly reset to:', cashReceiptElements.content.style.opacity);
        }

        // Reset loading guard
        isLoadingPayments = false;
        setLoadingButtons(false);
        console.log('✅ Loading guard reset, ready for next load');
    }
}

// Apply Status Filter — status field is the single source of truth
function applyStatusFilter(status) {
    console.log(`🔍 Filtering by status: ${status}`);
    cashReceiptState.currentFilter = status;

    if (status === 'all') {
        cashReceiptState.filteredPayments = [...cashReceiptState.allPayments];
    } else if (status === 'pending') {
        cashReceiptState.filteredPayments = cashReceiptState.allPayments.filter(p =>
            p.status === 'pending'
        );
    } else if (status === 'completed') {
        cashReceiptState.filteredPayments = cashReceiptState.allPayments.filter(p =>
            p.status === 'processed'
        );
    }

    console.log(`📋 Filtered payments: ${cashReceiptState.filteredPayments.length} of ${cashReceiptState.allPayments.length}`);

    cashReceiptState.currentPage = 1;
    renderCashReceiptsTable();
    updatePaginationControls();
}

// Handle Status Filter Click
function handleStatusFilterClick(e) {
    const btn = e.currentTarget;
    const status = btn.dataset.status;

    // Update button styles
    cashReceiptElements.statusFilters.forEach(b => {
        b.classList.remove('bg-emerald-100', 'text-emerald-800', 'border-2', 'border-emerald-500');
        b.classList.add('bg-gray-50', 'text-gray-600');
    });

    btn.classList.remove('bg-gray-50', 'text-gray-600');
    btn.classList.add('bg-emerald-100', 'text-emerald-800', 'border-2', 'border-emerald-500');

    // Apply filter
    applyStatusFilter(status);
}

// Search Cash Receipts
function searchCashReceipts(searchTerm) {
    console.log(`🔍 Searching for: "${searchTerm}"`);

    const term = searchTerm.toLowerCase().trim();

    if (!term) {
        // If search is empty, apply status filter to get full set
        applyStatusFilter(cashReceiptState.currentFilter);
        return;
    }

    // Filter by search term (bill number, retailer, sector)
    cashReceiptState.filteredPayments = cashReceiptState.allPayments.filter(p => {
        const billMatch = p.bill_number?.toLowerCase().includes(term);
        const retailerMatch = p.retailer_name?.toLowerCase().includes(term);
        const sectorMatch = p.sector?.toLowerCase().includes(term);
        return billMatch || retailerMatch || sectorMatch;
    });

    // Apply status filter on top of search — uses status field
    if (cashReceiptState.currentFilter === 'pending') {
        cashReceiptState.filteredPayments = cashReceiptState.filteredPayments.filter(p =>
            p.status === 'pending'
        );
    } else if (cashReceiptState.currentFilter === 'completed') {
        cashReceiptState.filteredPayments = cashReceiptState.filteredPayments.filter(p =>
            p.status === 'processed'
        );
    }

    console.log(`📋 Search results: ${cashReceiptState.filteredPayments.length} matches`);

    cashReceiptState.currentPage = 1;
    renderCashReceiptsTable();
    updatePaginationControls();
}

// Sort Cash Receipts
function sortCashReceipts(column) {
    console.log(`📊 Sorting by column: ${column}`);

    // Toggle sort direction
    if (cashReceiptState.sortColumn === column) {
        cashReceiptState.sortDirection = cashReceiptState.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        cashReceiptState.sortColumn = column;
        cashReceiptState.sortDirection = 'asc';
    }

    // Update visual indicators on all headers
    const headers = document.querySelectorAll('#cash-receipt-section .sortable[data-column] .sort-indicator');
    headers.forEach(indicator => {
        indicator.textContent = '⇅'; // Reset all to bidirectional
    });

    // Update the active column indicator
    const activeHeader = document.querySelector(`#cash-receipt-section .sortable[data-column="${column}"] .sort-indicator`);
    if (activeHeader) {
        activeHeader.textContent = cashReceiptState.sortDirection === 'asc' ? '↑' : '↓';
    }

    // Sort the filtered data
    cashReceiptState.filteredPayments.sort((a, b) => {
        let aVal = a[column];
        let bVal = b[column];

        // Handle null/undefined
        if (aVal == null) aVal = '';
        if (bVal == null) bVal = '';

        // Numeric comparison for amount
        if (column === 'payment_amount') {
            aVal = parseFloat(aVal) || 0;
            bVal = parseFloat(bVal) || 0;
        } else if (column === 'payment_date') {
            aVal = new Date(aVal).getTime();
            bVal = new Date(bVal).getTime();
        } else {
            // String comparison
            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();
        }

        if (cashReceiptState.sortDirection === 'asc') {
            return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
            return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
    });

    console.log(`✅ Sorted ${cashReceiptState.filteredPayments.length} payments by ${column} (${cashReceiptState.sortDirection}) - Icon: ${cashReceiptState.sortDirection === 'asc' ? '↑' : '↓'}`);

    cashReceiptState.currentPage = 1;
    renderCashReceiptsTable();
    updatePaginationControls();
}

// Helper — returns the payment objects for the current page
function getCurrentPageData() {
    const startIndex = (cashReceiptState.currentPage - 1) * cashReceiptState.itemsPerPage;
    const endIndex = startIndex + cashReceiptState.itemsPerPage;
    return cashReceiptState.filteredPayments.slice(startIndex, endIndex);
}

// Update bulk-actions bar visibility and selected count label
function updateBulkActionsBar() {
    const count = cashReceiptState.selectedPaymentIds.size;
    if (cashReceiptElements.bulkActionsBar) {
        if (count > 0) {
            cashReceiptElements.bulkActionsBar.classList.remove('hidden');
            cashReceiptElements.bulkActionsBar.classList.add('flex');
        } else {
            cashReceiptElements.bulkActionsBar.classList.add('hidden');
            cashReceiptElements.bulkActionsBar.classList.remove('flex');
        }
    }
    if (cashReceiptElements.selectedCountLabel) {
        cashReceiptElements.selectedCountLabel.textContent = `${count} selected`;
    }
}

// Render Cash Receipts Table
function renderCashReceiptsTable() {
    console.log('🏍️ Rendering cash receipts table...');

    if (!cashReceiptElements.tableBody) {
        console.error('❌ Table body element not found!');
        return;
    }

    const pageData = getCurrentPageData();

    console.log(`📄 Rendering ${pageData.length} payments`);

    if (pageData.length === 0) {
        console.log('⚠️ No payments to display');
        cashReceiptElements.tableBody.innerHTML = `
            <tr>
                <td colspan="10" class="text-center py-8 text-gray-500">
                    No cash payments found for the selected criteria
                </td>
            </tr>
        `;
    } else {
        cashReceiptElements.tableBody.innerHTML = pageData.map(payment => {
            const isCompleted = payment.status === 'processed';
            const statusBadge = isCompleted
                ? '<span class="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-semibold">Completed</span>'
                : '<span class="px-2 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">Pending</span>';

            const sourceLabel = payment.source === 'supply' ? 'Supply' :
                payment.source === 'ugrai' ? 'Ugrai Full' : 'Ugrai Partial';

            const isChecked = cashReceiptState.selectedPaymentIds.has(payment.id);
            const rowHighlight = isChecked ? 'bg-emerald-50' : 'hover:bg-gray-50';

            return `
                <tr class="${rowHighlight} transition-colors border-b border-gray-100" data-payment-id="${payment.id}">
                    <td class="p-3 text-center">
                        <input type="checkbox"
                               class="cr-row-checkbox w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                               data-id="${payment.id}"
                               ${isChecked ? 'checked' : ''}
                               onchange="handleRowCheckboxChange(this)">
                    </td>
                    <td class="p-3 text-gray-700">${formatDisplayDate(payment.payment_date)}</td>
                    <td class="p-3">
                        <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">${sourceLabel}</span>
                    </td>
                    <td class="p-3 text-gray-700 font-medium">${payment.bill_number || 'N/A'}</td>
                    <td class="p-3 text-gray-700">${payment.retailer_name || 'N/A'}</td>
                    <td class="p-3 text-gray-700">${payment.sector || 'N/A'}</td>
                    <td class="p-3 text-right text-gray-900 font-semibold">₹${formatAmount(payment.payment_amount)}</td>
                    <td class="p-3 text-gray-700">${payment.tally_receipt_number || '-'}</td>
                    <td class="p-3 text-center">${statusBadge}</td>
                    <td class="p-3 text-center">
                        <button 
                            class="px-3 py-1 text-xs font-medium rounded-lg transition-colors
                                   ${isCompleted ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}"
                            onclick="handleUpdateReceipt('${payment.id}', '${payment.tally_receipt_number || ''}', '${payment.bill_number}')"
                        >
                            ${isCompleted ? 'Update Receipt' : 'Add Receipt'}
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Sync select-all checkbox state
    if (cashReceiptElements.selectAllCheckbox) {
        const pageData2 = getCurrentPageData();
        const allChecked = pageData2.length > 0 && pageData2.every(p => cashReceiptState.selectedPaymentIds.has(p.id));
        cashReceiptElements.selectAllCheckbox.checked = allChecked;
        cashReceiptElements.selectAllCheckbox.indeterminate = !allChecked && pageData2.some(p => cashReceiptState.selectedPaymentIds.has(p.id));
    }

    updatePaginationControls();
}

// Update Statistics — pending count based on status field
function updateCashReceiptStatistics() {
    const totalCount = cashReceiptState.allPayments.length;
    const totalAmount = cashReceiptState.allPayments.reduce((sum, p) => sum + parseFloat(p.payment_amount || 0), 0);
    const pendingCount = cashReceiptState.allPayments.filter(p => p.status === 'pending').length;
    const completedCount = totalCount - pendingCount;

    if (cashReceiptElements.totalCount) {
        cashReceiptElements.totalCount.textContent = totalCount;
    }
    if (cashReceiptElements.totalAmount) {
        cashReceiptElements.totalAmount.textContent = '₹' + formatAmount(totalAmount);
    }
    if (cashReceiptElements.pendingCount) {
        cashReceiptElements.pendingCount.textContent = pendingCount;
    }

    // Update status counts
    if (cashReceiptElements.statusCountAll) {
        cashReceiptElements.statusCountAll.textContent = totalCount;
    }
    if (cashReceiptElements.statusCountPending) {
        cashReceiptElements.statusCountPending.textContent = pendingCount;
    }
    if (cashReceiptElements.statusCountCompleted) {
        cashReceiptElements.statusCountCompleted.textContent = completedCount;
    }
}

// Update Date Range Display
function updateDateRangeDisplay(fromDate, toDate) {
    if (!cashReceiptElements.dateRange) return;

    if (!fromDate && !toDate) {
        cashReceiptElements.dateRange.textContent = 'All cash payments';
    } else if (fromDate && toDate) {
        cashReceiptElements.dateRange.textContent = `${formatDisplayDate(fromDate)} to ${formatDisplayDate(toDate)}`;
    } else if (fromDate) {
        cashReceiptElements.dateRange.textContent = `From ${formatDisplayDate(fromDate)}`;
    } else {
        cashReceiptElements.dateRange.textContent = `Until ${formatDisplayDate(toDate)}`;
    }
}

// Update Pagination Controls
function updatePaginationControls() {
    const totalPages = Math.ceil(cashReceiptState.filteredPayments.length / cashReceiptState.itemsPerPage);
    const startIndex = (cashReceiptState.currentPage - 1) * cashReceiptState.itemsPerPage;
    const endIndex = Math.min(startIndex + cashReceiptState.itemsPerPage, cashReceiptState.filteredPayments.length);

    if (cashReceiptElements.showingStart) {
        cashReceiptElements.showingStart.textContent = cashReceiptState.filteredPayments.length > 0 ? startIndex + 1 : 0;
    }
    if (cashReceiptElements.showingEnd) {
        cashReceiptElements.showingEnd.textContent = endIndex;
    }
    if (cashReceiptElements.totalRecords) {
        cashReceiptElements.totalRecords.textContent = cashReceiptState.filteredPayments.length;
    }
    if (cashReceiptElements.pageInfo) {
        cashReceiptElements.pageInfo.textContent = `Page ${cashReceiptState.currentPage} of ${totalPages || 1}`;
    }

    // Enable/disable pagination buttons
    if (cashReceiptElements.prevPageBtn) {
        cashReceiptElements.prevPageBtn.disabled = cashReceiptState.currentPage === 1;
    }
    if (cashReceiptElements.nextPageBtn) {
        cashReceiptElements.nextPageBtn.disabled = cashReceiptState.currentPage >= totalPages;
    }
}

// Change Page
function changePage(direction) {
    const totalPages = Math.ceil(cashReceiptState.filteredPayments.length / cashReceiptState.itemsPerPage);
    const newPage = cashReceiptState.currentPage + direction;

    if (newPage >= 1 && newPage <= totalPages) {
        cashReceiptState.currentPage = newPage;
        renderCashReceiptsTable();
    }
}

// Handle row checkbox change (called from inline onchange)
function handleRowCheckboxChange(checkbox) {
    const id = checkbox.dataset.id;
    if (checkbox.checked) {
        cashReceiptState.selectedPaymentIds.add(id);
    } else {
        cashReceiptState.selectedPaymentIds.delete(id);
    }
    // Highlight the row
    const row = checkbox.closest('tr');
    if (row) {
        row.className = checkbox.checked
            ? 'bg-emerald-50 transition-colors border-b border-gray-100'
            : 'hover:bg-gray-50 transition-colors border-b border-gray-100';
    }
    // Sync select-all checkbox state
    if (cashReceiptElements.selectAllCheckbox) {
        const pageData = getCurrentPageData();
        const allChecked = pageData.length > 0 && pageData.every(p => cashReceiptState.selectedPaymentIds.has(p.id));
        cashReceiptElements.selectAllCheckbox.checked = allChecked;
        cashReceiptElements.selectAllCheckbox.indeterminate = !allChecked && pageData.some(p => cashReceiptState.selectedPaymentIds.has(p.id));
    }
    updateBulkActionsBar();
}

// Handle Update Receipt (individual — prompts for receipt number)
async function handleUpdateReceipt(paymentId, currentReceipt, referenceNumber) {
    const receiptNumber = prompt(
        `${currentReceipt ? 'Update' : 'Add'} Receipt Number\n\nPayment: ${referenceNumber}\nCurrent Receipt: ${currentReceipt || 'None'}\n\nLeave blank to mark complete without a receipt number.`,
        currentReceipt || ''
    );

    if (receiptNumber === null) return; // User cancelled

    try {
        // Find the payment
        const payment = cashReceiptState.allPayments.find(p => p.id === paymentId);
        if (!payment) {
            throw new Error('Payment not found');
        }

        const receiptData = {
            paymentId: String(payment.id),
            paymentSource: payment.source,
            sourceTable: payment.source === 'supply' ? 'approved_bills' : 'ugrai_payment_history',
            billNumber: payment.bill_number,
            billDate: payment.bill_date,
            retailerName: payment.retailer_name,
            sector: payment.sector,
            paymentAmount: payment.payment_amount,
            paymentDate: payment.payment_date,
            tallyReceiptNumber: receiptNumber.trim() // may be empty string → service normalises to null
        };

        await appState.supabaseService.submitCashReceipt(receiptData);

        showSuccess(`Receipt ${receiptNumber.trim() ? 'number saved' : 'marked complete'} successfully!`);
        await loadCashPayments();

    } catch (error) {
        console.error('❌ Error updating receipt:', error);
        if (error.message.includes('duplicate') || error.message.includes('already')) {
            alert('This receipt number already exists. Please use a unique receipt number.');
        } else {
            alert('Failed to update receipt: ' + error.message);
        }
    }
}

// Handle Bulk Complete — marks all selected payments as processed
async function handleBulkComplete() {
    const selectedIds = [...cashReceiptState.selectedPaymentIds];
    if (selectedIds.length === 0) return;

    const confirmed = confirm(
        `Mark ${selectedIds.length} payment${selectedIds.length > 1 ? 's' : ''} as Complete?\n\nThis will set their status to Completed without a receipt number. You can add receipt numbers individually later.`
    );
    if (!confirmed) return;

    // Disable button while processing
    if (cashReceiptElements.bulkCompleteBtn) {
        cashReceiptElements.bulkCompleteBtn.disabled = true;
        cashReceiptElements.bulkCompleteBtn.textContent = 'Processing...';
    }

    let successCount = 0;
    const errors = [];

    for (const id of selectedIds) {
        const payment = cashReceiptState.allPayments.find(p => p.id === id);
        if (!payment) continue;

        // Skip payments already completed
        if (payment.status === 'processed') {
            successCount++;
            continue;
        }

        try {
            await appState.supabaseService.submitCashReceipt({
                paymentId: String(payment.id),
                paymentSource: payment.source,
                sourceTable: payment.source === 'supply' ? 'approved_bills' : 'ugrai_payment_history',
                billNumber: payment.bill_number,
                billDate: payment.bill_date,
                retailerName: payment.retailer_name,
                sector: payment.sector,
                paymentAmount: payment.payment_amount,
                paymentDate: payment.payment_date,
                tallyReceiptNumber: '' // normalises to null in service
            });
            successCount++;
        } catch (err) {
            console.error(`❌ Failed to complete payment ${payment.bill_number}:`, err);
            errors.push(payment.bill_number);
        }
    }

    // Re-enable button
    if (cashReceiptElements.bulkCompleteBtn) {
        cashReceiptElements.bulkCompleteBtn.disabled = false;
        cashReceiptElements.bulkCompleteBtn.innerHTML = '<span>✅</span><span>Mark Selected as Complete</span>';
    }

    // Clear selection
    cashReceiptState.selectedPaymentIds.clear();
    updateBulkActionsBar();
    if (cashReceiptElements.selectAllCheckbox) {
        cashReceiptElements.selectAllCheckbox.checked = false;
    }

    if (errors.length > 0) {
        alert(`Completed ${successCount} payment(s).\nFailed: ${errors.join(', ')}`);
    } else {
        showSuccess(`✅ ${successCount} payment${successCount > 1 ? 's' : ''} marked as Complete!`);
    }

    await loadCashPayments();
}

// Expose to global scope for inline onclick handlers (ES module limitation)
window.handleUpdateReceipt = handleUpdateReceipt;
window.handleRowCheckboxChange = handleRowCheckboxChange;

// Export to CSV
function exportCashReceiptsToCSV() {
    console.log('📊 Exporting cash receipts to CSV...');

    if (cashReceiptState.filteredPayments.length === 0) {
        alert('No data to export');
        return;
    }

    // Prepare CSV headers
    const headers = [
        'Payment Date',
        'Source',
        'Bill/Ugrai Number',
        'Retailer Name',
        'Sector',
        'Payment Amount',
        'Receipt Number',
        'Receipt Date',
        'Tally Status',
        'Status'
    ];

    // Prepare CSV rows
    const rows = cashReceiptState.filteredPayments.map(payment => {
        const sourceLabel = payment.source === 'supply' ? 'Supply' :
            payment.source === 'ugrai' ? 'Ugrai Full' : 'Ugrai Partial';

        return [
            formatDisplayDate(payment.payment_date),
            sourceLabel,
            payment.bill_number || '',
            payment.retailer_name || '',
            payment.sector || '',
            payment.payment_amount || '0',
            payment.tally_receipt_number || '',
            payment.processed_date ? formatDisplayDate(payment.processed_date) : '',
            payment.status || 'pending',
            payment.status === 'processed' ? 'Completed' : 'Pending'
        ];
    });

    // Create CSV content
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    const fromDate = cashReceiptState.dateRange.from || 'all';
    const toDate = cashReceiptState.dateRange.to || 'all';
    const filename = `cash_receipts_${fromDate}_to_${toDate}_${Date.now()}.csv`;

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('✅ CSV exported successfully');
}

// Utility: Format Date for Input (YYYY-MM-DD)
function formatDateForInput(date) {
    if (!date) return '';
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Utility: Format Date for Display (DD/MM/YYYY)
function formatDisplayDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

// Utility: Format Amount
function formatAmount(amount) {
    return parseFloat(amount || 0).toFixed(2);
}

// Utility: Show Success Message
function showSuccess(message) {
    // Use existing notification system if available
    if (typeof showNotification === 'function') {
        showNotification(message, 'success');
    } else {
        alert(message);
    }
}

// Utility: Show Error Message
function showError(message) {
    // Use existing notification system if available
    if (typeof showNotification === 'function') {
        showNotification(message, 'error');
    } else {
        alert(message);
    }
}

// Initialize when Cash Receipt tab is activated
document.addEventListener('click', function (e) {
    const cashReceiptTab = e.target.closest('[data-process="cash-receipt"]');
    if (cashReceiptTab) {
        console.log('🏦 Cash Receipt main tab activated');

        // Show section (ensure it's visible)
        const section = document.getElementById('cash-receipt-section');
        const content = document.getElementById('cash-receipt-content');
        if (section) {
            section.style.display = 'block';
            section.classList.remove('hidden');
            console.log('✅ Section shown via main tab click');
        }
        if (content) {
            content.style.opacity = '1';
            content.style.pointerEvents = 'auto';
            console.log('✅ Content opacity ensured via main tab click');
        }

        // Load data if not already loaded or loading
        if (cashReceiptState.allPayments.length === 0 && !isLoadingPayments) {
            console.log('📥 No data yet, triggering load...');
            loadCashPayments().catch(err => {
                console.error('❌ Failed to load cash payments from tab click:', err);
            });
        } else if (isLoadingPayments) {
            console.log('⏳ Data already loading...');
        } else {
            console.log('✅ Data already loaded (', cashReceiptState.allPayments.length, 'payments)');
            // Data exists but table might not be rendered - force render
            console.log('🔄 Forcing table re-render with existing data...');
            renderCashReceiptsTable();
        }
    }
});

