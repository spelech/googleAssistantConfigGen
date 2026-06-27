// Global state
let entities = [];
let filteredEntities = [];
let rooms = [];
let currentAliases = [];
const collapsedGroups = new Set();

// DOM Elements
const totalEntitiesEl = document.getElementById('totalEntities');
const exposedEntitiesEl = document.getElementById('exposedEntities');
const searchInput = document.getElementById('searchInput');
const domainFilter = document.getElementById('domainFilter');
const roomFilter = document.getElementById('roomFilter');
const exposedOnlyCheckbox = document.getElementById('exposedOnlyCheckbox');
const entityTableBody = document.getElementById('entityTableBody');
const rebuildBtn = document.getElementById('rebuildBtn');

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

// Restart Modal Elements
const restartModal = document.getElementById('restartModal');
const cancelRestartBtn = document.getElementById('cancelRestartBtn');
const confirmRestartBtn = document.getElementById('confirmRestartBtn');

// Blocklist Modal Elements
const blocklistModal = document.getElementById('blocklistModal');
const manageBlocklistBtn = document.getElementById('manageBlocklistBtn');
const newBlocklistPattern = document.getElementById('newBlocklistPattern');
const addBlocklistPatternBtn = document.getElementById('addBlocklistPatternBtn');
const blocklistContainer = document.getElementById('blocklistContainer');
const closeBlocklistModal = document.getElementById('closeBlocklistModal');
const closeBlocklistModalBtn = document.getElementById('closeBlocklistModalBtn');

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

        // Update app version label
        const appVersionEl = document.getElementById('appVersion');
        if (appVersionEl && data.version) {
            appVersionEl.textContent = `Entity Console v${data.version}`;
        }
        
        // Extract unique rooms/areas
        const uniqueRooms = [...new Set(entities.map(e => e.area))].filter(r => r && r !== "TBA").sort();
        populateRoomFilter(uniqueRooms);
        
        updateStats();
        applyFilters();
    } catch (error) {
        showToast('Error loading entities: ' + error.message, 'error');
        entityTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--danger); padding: 3rem 0;">
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
    
    // Rebuild Button
    rebuildBtn.addEventListener('click', handleRebuild);
    
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

    // Restart Modal controls
    cancelRestartBtn.addEventListener('click', () => {
        restartModal.style.display = 'none';
    });
    confirmRestartBtn.addEventListener('click', handleRestart);

    // Blocklist Modal controls
    manageBlocklistBtn.addEventListener('click', () => {
        fetchBlocklist();
        blocklistModal.style.display = 'block';
    });
    const hideBlocklist = () => {
        blocklistModal.style.display = 'none';
    };
    closeBlocklistModal.addEventListener('click', hideBlocklist);
    closeBlocklistModalBtn.addEventListener('click', hideBlocklist);
    
    addBlocklistPatternBtn.addEventListener('click', () => {
        const val = newBlocklistPattern.value.trim();
        if (val) addBlocklistPattern(val);
    });
    newBlocklistPattern.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = newBlocklistPattern.value.trim();
            if (val) addBlocklistPattern(val);
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
            <td colspan="4" class="loading-state">
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

window.toggleGroup = function(groupKey, event) {
    if (event) event.stopPropagation();
    if (collapsedGroups.has(groupKey)) {
        collapsedGroups.delete(groupKey);
    } else {
        collapsedGroups.add(groupKey);
    }
    renderTable();
};

const domainNames = {
    light: 'Lights',
    switch: 'Switches',
    media_player: 'Media Players',
    fan: 'Fans',
    sensor: 'Sensors',
    binary_sensor: 'Binary Sensors',
    cover: 'Covers',
    climate: 'Climate Devices',
    lock: 'Locks',
    vacuum: 'Vacuums',
    scene: 'Scenes',
    script: 'Scripts',
    camera: 'Cameras',
    valve: 'Valves'
};

function getDomainName(domain) {
    return domainNames[domain] || (domain.charAt(0).toUpperCase() + domain.slice(1).replace('_', ' ') + 's');
}

function renderTable() {
    if (filteredEntities.length === 0) {
        entityTableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 3rem 0;">
                    No entities match the active filters.
                </td>
            </tr>
        `;
        return;
    }
    
    entityTableBody.innerHTML = '';
    
    // Group entities by floor, then by room, then by domain
    const groups = {};
    filteredEntities.forEach(e => {
        const floor = e.floor || 'No Floor';
        const room = e.area || 'No Room';
        const domain = e.domain || 'No Domain';
        if (!groups[floor]) {
            groups[floor] = {};
        }
        if (!groups[floor][room]) {
            groups[floor][room] = {};
        }
        if (!groups[floor][room][domain]) {
            groups[floor][room][domain] = [];
        }
        groups[floor][room][domain].push(e);
    });
    
    // Sort floor names (put "No Floor" or "TBA" at the end)
    const floorNames = Object.keys(groups).sort((a, b) => {
        if (a === 'No Floor' || a === 'TBA') return 1;
        if (b === 'No Floor' || b === 'TBA') return -1;
        return a.localeCompare(b);
    });
    
    floorNames.forEach(floor => {
        const floorKey = `floor:${floor}`;
        const isFloorCollapsed = collapsedGroups.has(floorKey);
        
        // Render Floor Header row
        const floorTr = document.createElement('tr');
        floorTr.className = 'floor-header-row';
        floorTr.style.cursor = 'pointer';
        floorTr.setAttribute('onclick', `toggleGroup('${floorKey}', event)`);
        
        const floorChevron = isFloorCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
        
        floorTr.innerHTML = `
            <td colspan="4" class="floor-header-cell">
                <i class="fa-solid ${floorChevron}" style="margin-right: 0.5rem; width: 12px;"></i>
                <i class="fa-solid fa-layer-group"></i> Floor: ${floor}
            </td>
        `;
        entityTableBody.appendChild(floorTr);
        
        if (isFloorCollapsed) {
            return;
        }
        
        const roomsInFloor = groups[floor];
        // Sort room names (put "No Room" or "TBA" at the end)
        const roomNames = Object.keys(roomsInFloor).sort((a, b) => {
            if (a === 'No Room' || a === 'TBA') return 1;
            if (b === 'No Room' || b === 'TBA') return -1;
            return a.localeCompare(b);
        });
        
        roomNames.forEach(room => {
            const roomKey = `room:${floor}:${room}`;
            const isRoomCollapsed = collapsedGroups.has(roomKey);
            
            // Render Room Header row
            const roomTr = document.createElement('tr');
            roomTr.className = 'room-header-row';
            roomTr.style.cursor = 'pointer';
            roomTr.setAttribute('onclick', `toggleGroup('${roomKey}', event)`);
            
            const roomChevron = isRoomCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
            
            roomTr.innerHTML = `
                <td colspan="4" class="room-header-cell">
                    <i class="fa-solid ${roomChevron}" style="margin-right: 0.5rem; width: 12px;"></i>
                    <i class="fa-solid fa-door-open"></i> ${room}
                </td>
            `;
            entityTableBody.appendChild(roomTr);
            
            if (isRoomCollapsed) {
                return;
            }
            
            const domainsInRoom = roomsInFloor[room];
            const domainKeys = Object.keys(domainsInRoom).sort();
            
            domainKeys.forEach(domain => {
                const domainKey = `domain:${floor}:${room}:${domain}`;
                const isDomainCollapsed = collapsedGroups.has(domainKey);
                
                // Render Domain Header row
                const domainTr = document.createElement('tr');
                domainTr.className = 'domain-header-row';
                domainTr.style.cursor = 'pointer';
                domainTr.setAttribute('onclick', `toggleGroup('${domainKey}', event)`);
                
                const domainChevron = isDomainCollapsed ? 'fa-chevron-right' : 'fa-chevron-down';
                
                domainTr.innerHTML = `
                    <td colspan="4" class="domain-header-cell" style="padding-left: 2rem !important; font-size: 0.85rem; font-weight: 600; color: var(--outline);">
                        <i class="fa-solid ${domainChevron}" style="margin-right: 0.5rem; width: 12px;"></i>
                        <i class="fa-solid fa-shapes"></i> ${getDomainName(domain)}
                    </td>
                `;
                entityTableBody.appendChild(domainTr);
                
                if (isDomainCollapsed) {
                    return;
                }
                
                const ents = domainsInRoom[domain];
                // Sort entities within the domain by ID
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
                        <td>
                            <div class="entity-info-wrapper">
                                <div class="entity-name"><strong>${e.display_name}</strong></div>
                                <div class="entity-id-subtext">${e.entity_id}</div>
                            </div>
                        </td>
                        <td class="inline-aliases-cell">
                            <div class="aliases-wrapper">
                                <div class="aliases-badges-list">${aliasBadges || '<span class="no-aliases">None</span>'}</div>
                                <button class="inline-add-alias-btn" onclick="openQuickAliasModal('${e.entity_id}', event)" title="Add nickname">
                                    <i class="fa-solid fa-plus"></i>
                                </button>
                            </div>
                        </td>
                        <td style="text-align: center;">${exposeBadge}</td>
                        <td class="action-cell" style="white-space: nowrap;">
                            <button class="action-btn" onclick="addToBlocklistDirectly('${e.entity_id}', event)" title="Block / Permanently Hide" style="color: var(--danger); margin-right: 0.25rem;">
                                <i class="fa-solid fa-eye-slash"></i>
                            </button>
                            <button class="action-btn" onclick="openEditModal('${e.entity_id}')" title="Edit Google Assistant Settings">
                                <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                        </td>
                    `;
                    entityTableBody.appendChild(tr);
                });
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

// Trigger YAML generation & rebuild
async function handleRebuild() {
    rebuildBtn.disabled = true;
    const icon = rebuildBtn.querySelector('i');
    icon.className = 'fa-solid fa-spinner fa-spin';
    
    try {
        const response = await fetch('/api/google_assistant_entity_console/rebuild', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({})
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Rebuild failed');
        }
        
        const result = await response.json();
        showToast(`Configuration generated successfully. (${result.exposed_count} entities exposed)`, 'success');
        // Open restart confirmation modal
        restartModal.style.display = 'block';
    } catch (error) {
        showToast('Error rebuilding configs: ' + error.message, 'error');
    } finally {
        rebuildBtn.disabled = false;
        icon.className = 'fa-solid fa-file-code';
    }
}

// Trigger Home Assistant restart
async function handleRestart() {
    confirmRestartBtn.disabled = true;
    cancelRestartBtn.disabled = true;
    confirmRestartBtn.textContent = 'Restarting...';
    
    try {
        const response = await fetch('/api/google_assistant_entity_console/restart', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({})
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Restart failed');
        }
        
        showToast('Home Assistant is restarting...', 'success');
        restartModal.style.display = 'none';
        
        // Wait and check back
        setTimeout(() => {
            window.location.reload();
        }, 12000);
    } catch (error) {
        showToast('Error restarting Home Assistant: ' + error.message, 'error');
        confirmRestartBtn.disabled = false;
        cancelRestartBtn.disabled = false;
        confirmRestartBtn.textContent = 'Yes, Restart';
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

// Fetch blocklist patterns from backend
async function fetchBlocklist() {
    blocklistContainer.innerHTML = '<span style="color: var(--on-surface-variant); font-size: 0.9rem; font-style: italic;">Loading blocklist...</span>';
    try {
        const response = await fetch('/api/google_assistant_entity_console/blocklist', {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to fetch blocklist');
        const data = await response.json();
        renderBlocklist(data.blocklist || []);
    } catch (error) {
        showToast('Error loading blocklist: ' + error.message, 'error');
        blocklistContainer.innerHTML = '<span style="color: var(--danger); font-size: 0.9rem;">Error loading blocklist patterns.</span>';
    }
}

// Render blocklist in the container
function renderBlocklist(patterns) {
    blocklistContainer.innerHTML = '';
    if (patterns.length === 0) {
        blocklistContainer.innerHTML = '<span style="color: var(--on-surface-variant); font-size: 0.9rem; font-style: italic; padding: 0.5rem 0;">No blocked patterns defined yet.</span>';
        return;
    }
    
    patterns.forEach(pattern => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justify = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '0.4rem 0.6rem';
        row.style.backgroundColor = 'rgba(255,255,255,0.03)';
        row.style.borderRadius = '6px';
        row.style.border = '1px solid var(--border)';
        
        row.innerHTML = `
            <code style="font-family: monospace; font-size: 0.9rem; color: var(--primary);">${pattern}</code>
            <button class="action-btn" onclick="removeBlocklistPattern('${pattern.replace(/'/g, "\\'")}')" title="Remove Pattern" style="color: var(--danger); width: 1.8rem; height: 1.8rem; font-size: 0.95rem;">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;
        blocklistContainer.appendChild(row);
    });
}

// Add a regex pattern to blocklist
async function addBlocklistPattern(pattern) {
    try {
        const response = await fetch('/api/google_assistant_entity_console/blocklist/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ pattern })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to add pattern');
        }
        newBlocklistPattern.value = '';
        showToast('Pattern added to blocklist', 'success');
        
        // Refresh local view and fetch blocklist details
        await fetchBlocklist();
        await fetchEntities();
    } catch (error) {
        showToast('Error adding pattern: ' + error.message, 'error');
    }
}

// Remove a regex pattern from blocklist
async function removeBlocklistPattern(pattern) {
    try {
        // Fetch current list first
        const getRes = await fetch('/api/google_assistant_entity_console/blocklist', {
            headers: getAuthHeaders()
        });
        if (!getRes.ok) throw new Error('Failed to load current list');
        const getData = await getRes.json();
        
        const updatedList = (getData.blocklist || []).filter(p => p !== pattern);
        
        const response = await fetch('/api/google_assistant_entity_console/blocklist', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ blocklist: updatedList })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to update blocklist');
        }
        
        showToast('Pattern removed from blocklist', 'success');
        renderBlocklist(updatedList);
        
        // Refresh entities table
        await fetchEntities();
    } catch (error) {
        showToast('Error removing pattern: ' + error.message, 'error');
    }
}

// Hide an entity directly by adding exact regex pattern to blocklist
window.addToBlocklistDirectly = async function(entityId, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Are you sure you want to block and permanently hide ${entityId}?`)) {
        return;
    }
    
    // Create an exact match pattern
    const pattern = `^${entityId.replace(/\./g, '\\.')}$`;
    
    try {
        const response = await fetch('/api/google_assistant_entity_console/blocklist/add', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...getAuthHeaders()
            },
            body: JSON.stringify({ pattern })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to block entity');
        }
        
        showToast(`${entityId} blocked and hidden`, 'success');
        
        // Remove locally from the array to immediately update UI
        entities = entities.filter(e => e.entity_id !== entityId);
        updateStats();
        applyFilters();
    } catch (error) {
        showToast('Error blocking entity: ' + error.message, 'error');
    }
};
