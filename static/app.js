// Global state
let entities = [];
let filteredEntities = [];
let rooms = [];
let currentAliases = [];

// DOM Elements
const totalEntitiesEl = document.getElementById('totalEntities');
const exposedEntitiesEl = document.getElementById('exposedEntities');
const searchInput = document.getElementById('searchInput');
const domainFilter = document.getElementById('domainFilter');
const roomFilter = document.getElementById('roomFilter');
const exposedOnlyCheckbox = document.getElementById('exposedOnlyCheckbox');
const entityTableBody = document.getElementById('entityTableBody');
const syncBtn = document.getElementById('syncBtn');

// Modal Elements
const editModal = document.getElementById('editModal');
const editForm = document.getElementById('editForm');
const modalEntityId = document.getElementById('modalEntityId');
const modalEntityIdDisplay = document.getElementById('modalEntityIdDisplay');
const modalFriendlyName = document.getElementById('modalFriendlyName');
const modalAliasInput = document.getElementById('modalAliasInput');
const addAliasBtn = document.getElementById('addAliasBtn');
const aliasBadgesContainer = document.getElementById('aliasBadgesContainer');
const modalExposedCheckbox = document.getElementById('modalExposedCheckbox');

// Init
document.addEventListener('DOMContentLoaded', () => {
    fetchEntities();
    setupEventListeners();
});

// Fetch all entities from backend
async function fetchEntities() {
    showTableLoading();
    try {
        const response = await fetch('/api/entities');
        if (!response.ok) throw new Error('Failed to fetch entities');
        entities = await response.json();
        
        // Extract unique rooms/areas
        const uniqueRooms = [...new Set(entities.map(e => e.area))].filter(r => r && r !== "TBA").sort();
        populateRoomFilter(uniqueRooms);
        
        updateStats();
        applyFilters();
    } catch (error) {
        showToast('Error loading entities: ' + error.message, 'error');
        entityTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--danger); padding: 3rem 0;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
            Error loading entity registry. Ensure the backend is running.
        </td></tr>`;
    }
}

// Event listeners setup
function setupEventListeners() {
    searchInput.addEventListener('input', applyFilters);
    domainFilter.addEventListener('change', applyFilters);
    roomFilter.addEventListener('change', applyFilters);
    exposedOnlyCheckbox.addEventListener('change', applyFilters);
    
    // Sync Button
    syncBtn.addEventListener('click', handleSync);
    
    // Modal controls
    document.querySelectorAll('.close-modal, .close-modal-btn').forEach(el => {
        el.addEventListener('click', closeModal);
    });
    
    // Edit Form submit
    editForm.addEventListener('submit', handleEditSubmit);
    
    // Add alias interactions
    addAliasBtn.addEventListener('click', addAliasFromInput);
    modalAliasInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addAliasFromInput();
        }
    });
}

function updateStats() {
    totalEntitiesEl.textContent = entities.length;
    exposedEntitiesEl.textContent = entities.filter(e => e.should_expose).length;
}

function populateRoomFilter(uniqueRooms) {
    // Keep the "All Rooms" option and append the rest
    roomFilter.innerHTML = '<option value="all">All Rooms</option>';
    uniqueRooms.forEach(room => {
        const opt = document.createElement('option');
        opt.value = room.toLowerCase();
        opt.textContent = room;
        roomFilter.appendChild(opt);
    });
}

function showTableLoading() {
    entityTableBody.innerHTML = `
        <tr>
            <td colspan="6" class="loading-state">
                <div class="spinner"></div>
                <span>Loading entity registry...</span>
            </td>
        </tr>
    `;
}

// Filter and render table
function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();
    const domain = domainFilter.value;
    const room = roomFilter.value;
    const exposedOnly = exposedOnlyCheckbox.checked;
    
    filteredEntities = entities.filter(e => {
        // Query match
        const matchesQuery = !query || 
            e.entity_id.toLowerCase().includes(query) || 
            e.display_name.toLowerCase().includes(query) || 
            e.aliases.some(a => a.toLowerCase().includes(query));
            
        // Domain match
        const matchesDomain = domain === 'all' || e.domain === domain;
        
        // Room match
        const matchesRoom = room === 'all' || e.area.toLowerCase() === room;
        
        // Exposed match
        const matchesExposed = !exposedOnly || e.should_expose;
        
        return matchesQuery && matchesDomain && matchesRoom && matchesExposed;
    });
    
    renderTable();
}

function renderTable() {
    if (filteredEntities.length === 0) {
        entityTableBody.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; color: var(--text-muted); padding: 3rem 0;">
                    No entities match the active filters.
                </td>
            </tr>
        `;
        return;
    }
    
    entityTableBody.innerHTML = '';
    filteredEntities.forEach(e => {
        const tr = document.createElement('tr');
        
        // Aliases rendering
        const aliasBadges = e.aliases.map(a => `<span class="badge alias-badge">${a}</span>`).join(' ') || '<span style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">None</span>';
        
        // Expose badge
        const exposeBadge = e.should_expose ? 
            `<span class="badge badge-exposed"><i class="fa-solid fa-circle-check" style="margin-right: 0.3rem;"></i>Yes</span>` : 
            `<span class="badge badge-not-exposed">No</span>`;
            
        tr.innerHTML = `
            <td class="entity-id-cell">${e.entity_id}</td>
            <td><strong>${e.display_name}</strong></td>
            <td class="room-cell">${e.area}</td>
            <td><div style="display: flex; flex-wrap: wrap; gap: 0.25rem;">${aliasBadges}</div></td>
            <td style="text-align: center;">${exposeBadge}</td>
            <td class="action-cell">
                <button class="action-btn" onclick="openEditModal('${e.entity_id}')" title="Edit Google Assistant Settings">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </td>
        `;
        entityTableBody.appendChild(tr);
    });
}

// Open Edit Modal
window.openEditModal = function(entityId) {
    const entity = entities.find(e => e.entity_id === entityId);
    if (!entity) return;
    
    modalEntityId.value = entity.entity_id;
    modalEntityIdDisplay.value = entity.entity_id;
    modalFriendlyName.value = entity.name || '';
    modalExposedCheckbox.checked = entity.should_expose;
    currentAliases = [...entity.aliases];
    
    renderAliasBadges();
    
    editModal.style.display = 'block';
};

function closeModal() {
    editModal.style.display = 'none';
    modalAliasInput.value = '';
}

function renderAliasBadges() {
    aliasBadgesContainer.innerHTML = '';
    if (currentAliases.length === 0) {
        aliasBadgesContainer.innerHTML = '<span style="font-size: 0.9rem; color: var(--text-muted); font-style: italic;">No aliases added.</span>';
        return;
    }
    
    currentAliases.forEach((alias, index) => {
        const badge = document.createElement('span');
        badge.className = 'alias-badge-edit';
        badge.innerHTML = `
            <span>${alias}</span>
            <i class="fa-solid fa-circle-xmark" onclick="removeAlias(${index})"></i>
        `;
        aliasBadgesContainer.appendChild(badge);
    });
}

window.removeAlias = function(index) {
    currentAliases.splice(index, 1);
    renderAliasBadges();
};

function addAliasFromInput() {
    const aliasText = modalAliasInput.value.trim();
    if (aliasText && !currentAliases.includes(aliasText)) {
        currentAliases.push(aliasText);
        renderAliasBadges();
        modalAliasInput.value = '';
    }
}

// Submit Edit
async function handleEditSubmit(e) {
    e.preventDefault();
    
    const entityId = modalEntityId.value;
    const name = modalFriendlyName.value.trim();
    const should_expose = modalExposedCheckbox.checked;
    
    const updatePayload = {
        entity_id: entityId,
        name: name || null,
        aliases: currentAliases,
        should_expose: should_expose
    };
    
    try {
        const response = await fetch('/api/entities/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updatePayload)
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to update entity');
        }
        
        // Update local state
        const entityIdx = entities.findIndex(ent => ent.entity_id === entityId);
        if (entityIdx !== -1) {
            entities[entityIdx].name = name || null;
            entities[entityIdx].display_name = name || entities[entityIdx].original_name || entityId.split('.').pop()?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '';
            entities[entityIdx].aliases = [...currentAliases];
            entities[entityIdx].should_expose = should_expose;
        }
        
        showToast('Settings saved successfully', 'success');
        closeModal();
        updateStats();
        applyFilters();
    } catch (error) {
        showToast('Error saving entity: ' + error.message, 'error');
    }
}

// Trigger YAML generation & sync reload
async function handleSync() {
    syncBtn.disabled = true;
    const icon = syncBtn.querySelector('i');
    icon.className = 'fa-solid fa-spinner fa-spin';
    
    try {
        const response = await fetch('/api/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Sync failed');
        }
        
        const result = await response.json();
        showToast(`Configuration generated. Sync sent. (${result.exposed_count} entities exposed)`, 'success');
    } catch (error) {
        showToast('Error syncing configs: ' + error.message, 'error');
    } finally {
        syncBtn.disabled = false;
        icon.className = 'fa-solid fa-rotate';
    }
}

// Toast notification helper
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.className = `toast show ${type}`;
    toast.innerHTML = `
        <i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i>
        <span>${message}</span>
    `;
    
    setTimeout(() => {
        toast.className = 'toast';
    }, 4000);
}
