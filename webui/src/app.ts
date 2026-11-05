// webui — App logic for FXDif 3D Enterprise

if (typeof $$ === 'undefined') {
  console.error('[App] FX framework not loaded.');
}

const API = {
  getProjects: () => fetch('/api/projects').then(r => r.json()),
  getProject: (code: string) => fetch(`/api/projects/${code}`).then(r => r.json()),
  createProject: (data: any) => fetch('/api/projects', { method: 'POST', body: JSON.stringify(data) }).then(r => r.json()),
  deleteProject: (code: string) => fetch(`/api/projects/${code}`, { method: 'DELETE' }).then(r => r.json()),
  
  getFolders: (code: string) => fetch(`/api/projects/${code}/folders`).then(r => r.json()),
  addFolder: (code: string, path: string) => fetch(`/api/projects/${code}/folders`, { method: 'POST', body: JSON.stringify({ folder_path: path }) }).then(r => r.json()),
  removeFolder: (code: string, path: string) => fetch(`/api/projects/${code}/folders`, { method: 'DELETE', body: JSON.stringify({ folder_path: path }) }).then(r => r.json()),
  
  getRules: (code: string) => fetch(`/api/projects/${code}/rules`).then(r => r.json()),
  addRule: (code: string, rule: any) => fetch(`/api/projects/${code}/rules`, { method: 'POST', body: JSON.stringify(rule) }).then(r => r.json()),
  
  getCompare: (code: string) => fetch(`/api/projects/${code}/compare`).then(r => r.json()),
  getFile: (path: string) => fetch(`/api/files/content?path=${encodeURIComponent(path)}`).then(r => r.json())
};

// ---------------------------------------------------------
// 3D Visualization (Three.js)
// ---------------------------------------------------------
let scene: any, camera: any, renderer: any, controls: any;
let raycaster: any, mouse: any;
let nodes: any[] = []; // Array of meshes representing files
const nodeDataMap = new Map(); // Mesh UUID -> File Data
let hoveredMesh: any = null;

const COLORS = {
  match: 0x00ff88,
  modified: 0xffb800,
  missing: 0xff0055,
  extra: 0x00f0ff
};

function init3D() {
  const canvas = document.getElementById('three-canvas') as HTMLCanvasElement;
  renderer = new (window as any).THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  
  scene = new (window as any).THREE.Scene();
  scene.fog = new (window as any).THREE.FogExp2(0x050505, 0.001);

  camera = new (window as any).THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(0, 30, 80);

  controls = new (window as any).THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxDistance = 500;

  // Lights
  const ambient = new (window as any).THREE.AmbientLight(0xffffff, 0.3);
  scene.add(ambient);
  
  const pointLight = new (window as any).THREE.PointLight(0x00f0ff, 1, 300);
  pointLight.position.set(0, 50, 0);
  scene.add(pointLight);

  // Background Grid Plane
  const gridHelper = new (window as any).THREE.GridHelper(500, 100, 0x00f0ff, 0x111111);
  gridHelper.position.y = -20;
  gridHelper.material.opacity = 0.2;
  gridHelper.material.transparent = true;
  scene.add(gridHelper);

  raycaster = new (window as any).THREE.Raycaster();
  mouse = new (window as any).THREE.Vector2();

  window.addEventListener('resize', onWindowResize);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('click', onMouseClick);

  animate3D();
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(event: MouseEvent) {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onMouseClick() {
  if (hoveredMesh) {
    const data = nodeDataMap.get(hoveredMesh.uuid);
    if (data && data.status !== 'missing') {
      const path = data.status === 'match' ? data.masterPath : data.comparePath;
      if (path) viewFile(path, data.status);
    }
  }
}

function animate3D() {
  requestAnimationFrame(animate3D);
  (window as any).TWEEN.update();
  controls.update();
  
  // Raycasting for hover effects
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(nodes);
  
  if (intersects.length > 0) {
    const object = intersects[0].object;
    if (hoveredMesh !== object) {
      if (hoveredMesh) {
        hoveredMesh.scale.set(1, 1, 1);
        hoveredMesh.material.emissive.setHex(0x000000);
      }
      hoveredMesh = object;
      hoveredMesh.scale.set(1.5, 1.5, 1.5);
      hoveredMesh.material.emissive.setHex(hoveredMesh.material.color.getHex());
      hoveredMesh.material.emissiveIntensity = 0.5;
      
      const data = nodeDataMap.get(hoveredMesh.uuid);
      showTooltip(data);
    }
  } else {
    if (hoveredMesh) {
      hoveredMesh.scale.set(1, 1, 1);
      hoveredMesh.material.emissive.setHex(0x000000);
      hoveredMesh = null;
      hideTooltip();
    }
  }

  // Slowly rotate the entire group of nodes if no hover
  if (scene.children.find((c:any) => c.name === 'NodesGroup') && !hoveredMesh) {
    const group = scene.children.find((c:any) => c.name === 'NodesGroup');
    group.rotation.y += 0.001;
  }

  renderer.render(scene, camera);
}

function showTooltip(data: any) {
  if (!data) return;
  const tooltip = document.getElementById('node-tooltip')!;
  tooltip.style.display = 'block';
  tooltip.querySelector('.filename')!.textContent = data.relativePath;
  tooltip.querySelector('.folder')!.textContent = `Folder: ${data.folderName}`;
  tooltip.innerHTML = tooltip.innerHTML.replace(/Status: .*/, `Status: ${data.status.toUpperCase()}`);
  
  const color = COLORS[data.status as keyof typeof COLORS];
  tooltip.style.borderColor = '#' + color.toString(16).padStart(6, '0');
  
  // Update tooltip position in animation loop for smooth tracking
  const updatePos = () => {
    if (hoveredMesh) {
      tooltip.style.left = (mouse.x * window.innerWidth / 2 + window.innerWidth / 2 + 15) + 'px';
      tooltip.style.top = (-mouse.y * window.innerHeight / 2 + window.innerHeight / 2 + 15) + 'px';
      requestAnimationFrame(updatePos);
    }
  };
  updatePos();
}

function hideTooltip() {
  document.getElementById('node-tooltip')!.style.display = 'none';
}

function clear3DNodes() {
  const existingGroup = scene.children.find((c:any) => c.name === 'NodesGroup');
  if (existingGroup) {
    scene.remove(existingGroup);
  }
  nodes = [];
  nodeDataMap.clear();
}

function build3DGraph(compData: any) {
  clear3DNodes();
  
  const group = new (window as any).THREE.Group();
  group.name = 'NodesGroup';
  
  const geometry = new (window as any).THREE.BoxGeometry(1.5, 1.5, 1.5);
  
  let i = 0;
  const totalItems = Object.values(compData.compareFolders).reduce((acc: number, f: any) => acc + (f.results?.length || 0), 0);
  
  // Spherical layout
  const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
  
  for (const folderName in compData.compareFolders) {
    const items = compData.compareFolders[folderName].results || [];
    for (const item of items) {
      const color = COLORS[item.status as keyof typeof COLORS] || 0xffffff;
      const material = new (window as any).THREE.MeshLambertMaterial({ 
        color, 
        transparent: true, 
        opacity: 0.8
      });
      
      const mesh = new (window as any).THREE.Mesh(geometry, material);
      
      // Fibonacci sphere distribution
      const y = 1 - (i / (totalItems - 1)) * 2; 
      const radius = Math.sqrt(1 - y * y);
      const theta = phi * i;

      const spread = Math.max(30, Math.pow(totalItems, 0.4) * 5);

      const targetX = Math.cos(theta) * radius * spread;
      const targetY = y * spread;
      const targetZ = Math.sin(theta) * radius * spread;
      
      // Starting position for animation (at center)
      mesh.position.set(0, -20, 0);
      mesh.scale.set(0.01, 0.01, 0.01);
      
      new (window as any).TWEEN.Tween(mesh.position)
        .to({ x: targetX, y: targetY, z: targetZ }, 1500 + Math.random() * 1000)
        .easing((window as any).TWEEN.Easing.Exponential.Out)
        .start();
        
      new (window as any).TWEEN.Tween(mesh.scale)
        .to({ x: 1, y: 1, z: 1 }, 1000 + Math.random() * 500)
        .easing((window as any).TWEEN.Easing.Elastic.Out)
        .start();

      group.add(mesh);
      nodes.push(mesh);
      
      nodeDataMap.set(mesh.uuid, {
        ...item,
        folderName
      });
      
      i++;
    }
  }
  
  scene.add(group);
}


// ---------------------------------------------------------
// UI Application Logic
// ---------------------------------------------------------
let editor: any = null;

$(document).ready(() => {
  init3D();
  
  require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.38.0/min/vs' }});
  require(['vs/editor/editor.main'], function() {
    editor = (window as any).monaco.editor.create(document.getElementById('monaco-container')!, {
      value: '',
      language: 'plaintext',
      theme: 'vs-dark',
      readOnly: true,
      minimap: { enabled: false }
    });
    window.addEventListener('resize', () => { if (editor) editor.layout(); });
  });

  loadProjects();

  // Project Creation Toggle
  $('#btn-new-project').on('click', () => {
    $('#new-project-form').css('display', 'block');
  });
  $('#btn-cancel-project').on('click', () => {
    $('#new-project-form').css('display', 'none');
    $('#inp-proj-name').val('');
    $('#inp-proj-code').val('');
    $('#inp-proj-path').val('');
  });
  
  $('#btn-save-project').on('click', async () => {
    const name = $('#inp-proj-name').val();
    const code = $('#inp-proj-code').val();
    const path = $('#inp-proj-path').val();
    if (!name || !code || !path) return alert('Fill all fields');
    
    showLoader();
    try {
      const res = await API.createProject({ project_name: name, project_code: code, base_path: path });
      if (res.error) alert(res.error);
      else {
        $('#btn-cancel-project').trigger('click');
        await loadProjects();
      }
    } catch(e) { console.error(e); }
    hideLoader();
  });

  // Panel toggles
  $('#btn-toggle-panel').on('click', () => $('#right-panel').addClass('open'));
  $('#btn-close-panel').on('click', () => $('#right-panel').removeClass('open'));
  
  // Folder management
  $('#btn-add-folder').on('click', async () => {
    const p = $$('app.currentProject').get();
    if (!p) return;
    const path = $('#inp-folder-path').val();
    if (!path) return;
    showLoader();
    await API.addFolder(p.code, path);
    $('#inp-folder-path').val('');
    await loadConfig(p.code);
    hideLoader();
  });

  $('#folders-list').on('click', '.btn-remove-folder', async function() {
    const p = $$('app.currentProject').get();
    if (!p) return;
    const path = $(this).attr('data-path');
    showLoader();
    await API.removeFolder(p.code, path);
    await loadConfig(p.code);
    hideLoader();
  });

  // Rules management
  $('#btn-add-rule').on('click', async () => {
    const p = $$('app.currentProject').get();
    if (!p) return;
    const type = $('#inp-rule-type').val();
    const action = $('#inp-rule-action').val();
    const pattern = $('#inp-rule-pattern').val();
    if (!pattern) return;
    showLoader();
    await API.addRule(p.code, { rule_type: type, action, pattern });
    $('#inp-rule-pattern').val('');
    await loadConfig(p.code);
    hideLoader();
  });

  $('#btn-refresh-scan').on('click', async () => {
    const p = $$('app.currentProject').get();
    if (!p) return;
    await runScan(p);
  });

  $('#projects-list').on('click', '.btn-del-proj', async function(e: any) {
    e.stopPropagation();
    if (!confirm('Delete project?')) return;
    const code = $(this).attr('data-code');
    showLoader();
    await API.deleteProject(code);
    await loadProjects();
    hideLoader();
    $$('app.currentProject').set(null);
    $('#current-project-title').text('Select a Project');
    $('#metrics-bar').css('opacity', '0');
    $('#btn-toggle-panel').css('display', 'none');
    $('#right-panel').removeClass('open');
    clear3DNodes();
  });

  $('#close-editor').on('click', () => $('#editor-modal').removeClass('active'));
});

function showLoader() { $('#global-loader').css('display', 'block'); }
function hideLoader() { $('#global-loader').css('display', 'none'); }

async function loadProjects() {
  const data = await API.getProjects();
  $$('app.projects').set(data.projects || []);
  
  let html = '';
  for (const p of (data.projects || [])) {
    html += `
      <div class="project-item" data-code="${p.project_code}">
        <div class="proj-info">
          <i class="fa-solid fa-cube"></i>
          <span>${p.project_name}</span>
        </div>
        <div class="proj-actions">
          <button class="action-btn btn-del-proj" data-code="${p.project_code}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
  }
  $('#projects-list').html(html);

  $('#projects-list').on('click', '.project-item', async function() {
    $('.project-item').removeClass('active');
    $(this).addClass('active');
    const code = $(this).attr('data-code');
    const pData = await API.getProject(code);
    if (pData.project) {
      $$('app.currentProject').set({ ...pData.project, code });
      $('#current-project-title').text(pData.project.project_name);
      $('#btn-toggle-panel').css('display', 'flex');
      await loadConfig(code);
      await runScan({ code });
    }
  });
}

async function loadConfig(code: string) {
  const fData = await API.getFolders(code);
  const rData = await API.getRules(code);
  
  // Render Folders
  let fHtml = '';
  for (const f of (fData.folders || [])) {
    const isMaster = f.is_master === 1;
    fHtml += `
      <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; font-size: 0.8rem; border: 1px solid var(--border-color);">
        <span style="color: ${isMaster ? 'var(--accent)' : 'inherit'}">
          ${isMaster ? '<i class="fa-solid fa-star"></i> ' : ''}${f.folder_path.split(/[\\\/]/).pop()}
        </span>
        ${!isMaster ? `<button class="action-btn btn-remove-folder" data-path="${f.folder_path}"><i class="fa-solid fa-trash"></i></button>` : ''}
      </div>
    `;
  }
  $('#folders-list').html(fHtml);

  // Render Rules
  let extHtml = '', fileHtml = '';
  for (const r of (rData.rules || [])) {
    const tag = `<span class="rule-tag ${r.action}">${r.action === 'include' ? '+' : '-'} ${r.pattern}</span>`;
    if (r.rule_type === 'extension') extHtml += tag;
    else fileHtml += tag;
  }
  $('#rules-ext-list').html(extHtml || '<span style="font-size:0.7rem; color:var(--text-muted)">None</span>');
  $('#rules-file-list').html(fileHtml || '<span style="font-size:0.7rem; color:var(--text-muted)">None</span>');
}

async function runScan(project: any) {
  showLoader();
  try {
    const data = await API.getCompare(project.code);
    if (data.error) throw new Error(data.error);
    
    const comp = data.comparison;
    let metrics = { total: 0, match: 0, modified: 0, missing: 0, extra: 0 };
    
    for (const folderName in comp.compareFolders) {
      const items = comp.compareFolders[folderName].results || [];
      metrics.total += items.length;
      for (const item of items) {
        if (metrics[item.status as keyof typeof metrics] !== undefined) {
          metrics[item.status as keyof typeof metrics]++;
        }
      }
    }
    
    $('#metric-total').text(metrics.total);
    $('#metric-match').text(metrics.match);
    $('#metric-modified').text(metrics.modified);
    $('#metric-missing').text(metrics.missing);
    $('#metrics-bar').css('opacity', '1');

    build3DGraph(comp);

  } catch (e: any) {
    console.error(e);
    alert("Scan Error: " + e.message);
  }
  hideLoader();
}

function getExt(filename: string) {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop() : 'txt';
}

async function viewFile(filePath: string, status: string) {
  if (!editor) return;
  
  $('#editor-modal').addClass('active');
  const filename = filePath.split(/[\\\/]/).pop() || 'file';
  $('#editor-filename').text(filename);
  
  const badge = $('#editor-badge');
  badge.text(status.toUpperCase());
  const color = COLORS[status as keyof typeof COLORS];
  badge.css('color', '#' + color.toString(16).padStart(6, '0'));
  badge.css('border', '1px solid #' + color.toString(16).padStart(6, '0'));

  editor.setValue('Loading...');
  editor.layout();
  
  try {
    const res = await API.getFile(filePath);
    if (res.error) editor.setValue(`Error: ${res.error}`);
    else {
      editor.setValue(res.content || '');
      const ext = getExt(filename)?.toLowerCase();
      let lang = 'plaintext';
      const langMap: Record<string, string> = {
        'ts': 'typescript', 'js': 'javascript', 'json': 'json',
        'html': 'html', 'css': 'css', 'md': 'markdown',
        'rs': 'rust', 'py': 'python', 'yaml': 'yaml', 'yml': 'yaml'
      };
      if (ext && langMap[ext]) lang = langMap[ext];
      (window as any).monaco.editor.setModelLanguage(editor.getModel(), lang);
    }
  } catch (err) {
    editor.setValue('Failed to load file.');
  }
}
