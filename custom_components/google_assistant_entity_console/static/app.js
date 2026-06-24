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

// Get auth headers from URL token parameter or session storage
function getAuthHeaders() {
    const params = new URLSearchParams(window.location.search);
    let token = params.get('token');
    if (token) {
        sessionStorage.setItem('ha_token', token);
    } else {
        token = sessionStorage.getItem('ha_token');
    }
    
    if (token) {
        return {
            'Authorization': `Bearer ${token}`
        };
    }
    return {};
}

// Init
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        fetchEntities();
        setupEventListeners();
    });
} else {
    fetchEntities();
    setupEventListeners();
}

// Fetch all entities from backend
async function fetchEntities() {
    showTableLoading();
    try {
        const response = await fetch('/api/google_assistant_entity_console/entities', {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to fetch entities');
        
        const data = await response.json();
        entities = Array.isArray(data) ? data : (data.entities || []);
        
        // Update Active YAML Config display name
        const configFileEl = document.getElementById('configFile');
        if (configFileEl) {
            configFileEl.textContent = Array.isArray(data) ? 'gaGen_112225.yaml' : (data.yaml_filename || 'None (Not Configured)');
        }
        
        // Extract unique rooms/areas
        const uniqueRooms = [...new Set(entities.map(e => e.area))].filter(r => r && r !== "TBA").sort();
        populateRoomFilter(uniqueRooms);
        
        updateStats();
        applyFilters();
    } catch (error) {
        showToast('Error loading entities: ' + error.message, 'error');
        entityTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 3rem 0;">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 0.5rem; display: block;"></i>
            Error loading entity registry. Ensure Home Assistant integration is active.
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
            <td colspan="5" class="loading-state">
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
        
        // Exposed match (either marked in registry or currently exposed in YAML)
        const matchesExposed = !exposedOnly || e.should_expose || e.yaml_exposed;
        
        return matchesQuery && matchesDomain && matchesRoom && matchesExposed;
    });
    
    renderTable();
}

function renderTable() {
    if (filteredEntities.length === 0) {
        entityTableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem 0;">
                    No entities match the active filters.
                </td>
            </tr>
        `;
        return;
    }
    
    entityTableBody.innerHTML = '';
    
    // Group entities by floor, then by room
    const groups = {};
    filteredEntities.forEach(e => {
        const floor = e.floor || 'No Floor';
        const room = e.area || 'No Room';
        if (!groups[floor]) {
            groups[floor] = {};
        }
        if (!groups[floor][room]) {
            groups[floor][room] = [];
        }
        groups[floor][room].push(e);
    });
    
    // Sort floor names (put "No Floor" or "TBA" at the end)
    const floorNames = Object.keys(groups).sort((a, b) => {
        if (a === 'No Floor' || a === 'TBA') return 1;
        if (b === 'No Floor' || b === 'TBA') return -1;
        return a.localeCompare(b);
    });
    
    floorNames.forEach(floor => {
        // Render Floor Header row
        const floorTr = document.createElement('tr');
        floorTr.className = 'floor-header-row';
        floorTr.innerHTML = `
            <td colspan="5" class="floor-header-cell">
                <i class="fa-solid fa-layer-group"></i> Floor: ${floor}
            </td>
        `;
        entityTableBody.appendChild(floorTr);
        
        const roomsInFloor = groups[floor];
        // Sort room names (put "No Room" or "TBA" at the end)
        const roomNames = Object.keys(roomsInFloor).sort((a, b) => {
            if (a === 'No Room' || a === 'TBA') return 1;
            if (b === 'No Room' || b === 'TBA') return -1;
            return a.localeCompare(b);
        });
        
        roomNames.forEach(room => {
            // Render Room Header row
            const roomTr = document.createElement('tr');
            roomTr.className = 'room-header-row';
            roomTr.innerHTML = `
                <td colspan="5" class="room-header-cell">
                    <i class="fa-solid fa-door-open"></i> ${room}
                </td>
            `;
            entityTableBody.appendChild(roomTr);
            
            const ents = roomsInFloor[room];
            // Sort entities within the room by ID
            ents.sort((a, b) => a.entity_id.localeCompare(b.entity_id));
            
            ents.forEach(e => {
                const tr = document.createElement('tr');
                tr.className = 'entity-row';
                
                // Filter out invalid/empty/0 nicknames
                const validAliases = (e.aliases || []).filter(a => a && a !== '0' && a !== 0);
                
                // Aliases rendering with inline "Add" button
                const aliasBadges = validAliases.map(a => `<span class="badge alias-badge">${a}</span>`).join(' ');
                
                // Expose status badge
                let exposeBadge = '';
                if (e.yaml_exposed && e.should_expose) {
                    exposeBadge = `<span class="badge badge-exposed"><i class="fa-solid fa-circle-check" style="margin-right: 0.3rem;"></i>Exposed</span>`;
                } else if (e.should_expose && !e.yaml_exposed) {
                    exposeBadge = `<span class="badge badge-pending-expose"><i class="fa-solid fa-circle-pause" style="margin-right: 0.3rem;"></i>Pending Add</span>`;
                } else if (!e.should_expose && e.yaml_exposed) {
                    exposeBadge = `<span class="badge badge-pending-remove"><i class="fa-solid fa-circle-minus" style="margin-right: 0.3rem;"></i>Pending Remove</span>`;
                } else {
                    exposeBadge = `<span class="badge badge-not-exposed">No</span>`;
                }
                
                tr.innerHTML = `
                    <td class="entity-id-cell">${e.entity_id}</td>
                    <td><strong>${e.display_name}</strong></td>
                    <td class="inline-aliases-cell">
                        <div class="aliases-wrapper">
                            <div class="aliases-badges-list">${aliasBadges || '<span class="no-aliases">None</span>'}</div>
                            <button class="inline-add-alias-btn" onclick="openQuickAliasModal('${e.entity_id}', event)" title="Add nickname">
                                <i class="fa-solid fa-plus"></i>
                            </button>
                        </div>
                    </td>
                    <td style="text-align: center;">${exposeBadge}</td>
                    <td class="action-cell">
                        <button class="action-btn" onclick="openEditModal('${e.entity_id}')" title="Edit Google Assistant Settings">
                            <i class="fa-solid fa-pen-to-square"></i>
                        </button>
                    </td>
                `;
                entityTableBody.appendChild(tr);
            });
        });
    });
}

// Inline Quick Nickname Input Handler
window.openQuickAliasModal = function(entityId, event) {
    event.stopPropagation();
    const btn = event.currentTarget;
    const wrapper = btn.closest('.aliases-wrapper');
    if (!wrapper) return;
    
    // Hide list and button
    const list = wrapper.querySelector('.aliases-badges-list');
    btn.style.display = 'none';
    if (list) list.style.display = 'none';
    
    // Create inline input
    const container = document.createElement('div');
    container.className = 'inline-alias-input-container';
    container.innerHTML = `
        <input type="text" class="inline-alias-input" placeholder="Nickname..." autofocus>
        <button class="inline-alias-submit-btn" title="Save"><i class="fa-solid fa-check"></i></button>
        <button class="inline-alias-cancel-btn" title="Cancel"><i class="fa-solid fa-xmark"></i></button>
    `;
    
    wrapper.appendChild(container);
    
    const input = container.querySelector('.inline-alias-input');
    const submitBtn = container.querySelector('.inline-alias-submit-btn');
    const cancelBtn = container.querySelector('.inline-alias-cancel-btn');
    
    input.focus();
    
    const cleanup = () => {
        container.remove();
        btn.style.display = '';
        if (list) list.style.display = '';
    };
    
    cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cleanup();
    });
    
    const submit = async () => {
        const val = input.value.trim();
        if (!val || val === '0') {
            cleanup();
            return;
        }
        
        const entity = entities.find(e => e.entity_id === entityId);
        if (!entity) {
            cleanup();
            return;
        }
        
        if (entity.aliases.includes(val)) {
            showToast('Nickname already exists', 'error');
            cleanup();
            return;
        }
        
        const updatedAliases = [...entity.aliases, val];
        
        try {
            const response = await fetch('/api/google_assistant_entity_console/entities/update', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...getAuthHeaders()
                },
                body: JSON.stringify({
                    entity_id: entityId,
                    name: entity.name,
                    aliases: updatedAliases,
                    should_expose: entity.should_expose
                })
            });
            
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Failed to add nickname');
            }
            
            entity.aliases = updatedAliases;
            showToast('Nickname added successfully', 'success');
            applyFilters();
        } catch (error) {
            showToast('Error adding nickname: ' + error.message, 'error');
            cleanup();
        }
    };
    
    submitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        submit();
    });
    
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cleanup();
        }
    });
};

// Open Edit Modal
window.openEditModal = function(entityId) {
    const entity = entities.find(e => e.entity_id === entityId);
    if (!entity) return;
    
    modalEntityId.value = entity.entity_id;
    modalEntityIdDisplay.value = entity.entity_id;
    modalFriendlyName.value = entity.name || '';
    modalExposedCheckbox.checked = entity.should_expose;
    
    // Filter out invalid aliases
    currentAliases = [...(entity.aliases || [])].filter(a => a && a !== '0' && a !== 0);
    
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
        aliasBadgesContainer.innerHTML = '<span style="font-size: 0.9rem; color: var(--text-muted); font-style: italic;">No nicknames added.</span>';
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
    if (aliasText && aliasText !== '0' && !currentAliases.includes(aliasText)) {
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
        const response = await fetch('/api/google_assistant_entity_console/entities/update', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify(updatePayload)
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to update entity');
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
        const response = await fetch('/api/google_assistant_entity_console/sync', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({})
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Sync failed');
        }
        
        const result = await response.json();
        showToast(`Configuration generated. Sync sent. (${result.exposed_count} entities exposed)`, 'success');
        // Refresh entities state from backend to update yaml_exposed values
        await fetchEntities();
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
