// Variables globales
const { jsPDF } = window.jspdf;
let segments = [];
let pressureChart = null;
let editingIndex = -1;
let nextPiValue = null;
let currentClient = null;
const confirmModal = new bootstrap.Modal(document.getElementById('confirmModal'));
const nodePressures = new Map();

// Inicialización
document.addEventListener('DOMContentLoaded', function() {
  // Inicializar tabs
  const tabElms = document.querySelectorAll('button[data-bs-toggle="tab"]');
  tabElms.forEach(tabEl => {
    tabEl.addEventListener('click', function(event) {
      event.preventDefault();
      const tab = new bootstrap.Tab(this);
      tab.show();
    });
  });

  loadClientData();
  const forms = document.querySelectorAll('.needs-validation');
  Array.from(forms).forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopPropagation();
    }, false);
  });
  updatePiField();
});

// ==================== FUNCIONES DE CLIENTE ====================

function saveClientData() {
  const form = document.getElementById('clientForm');
  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    return;
  }
  currentClient = {
    type: document.getElementById('clientType').value,
    id: document.getElementById('clientId').value,
    name: document.getElementById('clientName').value,
    address: document.getElementById('clientAddress').value,
    city: document.getElementById('clientCity').value,
    department: document.getElementById('clientDepartment').value,
    phone: document.getElementById('clientPhone').value,
    email: document.getElementById('clientEmail').value,
    projectType: document.getElementById('projectType').value,
    gasType: document.getElementById('gasType').value,
    timestamp: new Date().toISOString()
  };
  localStorage.setItem('currentGasClient', JSON.stringify(currentClient));
  updateClientSummary();
  showAlert('Datos del cliente guardados correctamente', 'success');
  new bootstrap.Tab(document.getElementById('calculation-tab')).show();
}

function loadClientData() {
  const savedClient = localStorage.getItem('currentGasClient');
  if (savedClient) {
    currentClient = JSON.parse(savedClient);
    document.getElementById('clientType').value = currentClient.type;
    document.getElementById('clientId').value = currentClient.id;
    document.getElementById('clientName').value = currentClient.name;
    document.getElementById('clientAddress').value = currentClient.address;
    document.getElementById('clientCity').value = currentClient.city;
    document.getElementById('clientDepartment').value = currentClient.department;
    document.getElementById('clientPhone').value = currentClient.phone;
    document.getElementById('clientEmail').value = currentClient.email;
    document.getElementById('projectType').value = currentClient.projectType;
    document.getElementById('gasType').value = currentClient.gasType;
    updateClientSummary();
  }
}

function updateClientSummary() {
  if (!currentClient) return;
  document.getElementById('sumClientId').textContent = `${currentClient.type}: ${currentClient.id}`;
  document.getElementById('sumClientName').textContent = currentClient.name;
  document.getElementById('sumClientPhone').textContent = currentClient.phone;
  document.getElementById('sumClientAddress').textContent = currentClient.address;
  document.getElementById('sumClientCity').textContent = currentClient.city;
  document.getElementById('sumClientDepartment').textContent = currentClient.department;
  document.getElementById('sumProjectType').textContent = currentClient.projectType;
  document.getElementById('sumGasType').textContent = currentClient.gasType;
  document.getElementById('sumClientEmail').textContent = currentClient.email || 'No especificado';
  document.getElementById('clientSummary').style.display = 'block';
}

function clearClientForm() {
  showConfirm('¿Está seguro de limpiar todos los datos del cliente?', function() {
    document.getElementById('clientForm').reset();
    document.getElementById('clientForm').classList.remove('was-validated');
    currentClient = null;
    localStorage.removeItem('currentGasClient');
    document.getElementById('clientSummary').style.display = 'none';
    showAlert('Formulario de cliente limpiado', 'info');
  });
}

// ==================== FUNCIONES DE CÁLCULO ====================

function sanitizeNodeName(name) {
  return name.replace(/[<>&"']/g, '').toUpperCase();
}

function validateSegment(segment) {
  if (segment.inicio === segment.fin) {
    return { valid: false, message: "El nodo inicial y final deben ser diferentes" };
  }
  if (segment.longitud < 0.01) {
    return { valid: false, message: "La longitud debe ser mayor o igual a 0.01 metros" };
  }
  if (segment.diametro < 0.05) {
    return { valid: false, message: "El diámetro debe ser mayor o igual a 0.05 mm" };
  }
  const nodeRegex = /^[A-Za-z0-9'_-]+$/;
  if (!nodeRegex.test(segment.inicio) || !nodeRegex.test(segment.fin)) {
    return { valid: false, message: "Los nodos solo pueden contener letras, números, ', _ o -" };
  }
  return { valid: true };
}

function validateNetwork(segments) {
  if (segments.length === 0) return { valid: true };
  
  const nodes = new Set();
  const edges = new Set();
  segments.forEach(s => {
    nodes.add(s.inicio);
    nodes.add(s.fin);
    edges.add(`${s.inicio}-${s.fin}`);
  });

  // Verificar si hay nodos desconectados
  const reachable = new Set([segments[0]?.inicio]);
  let changed = true;
  while (changed) {
    changed = false;
    segments.forEach(s => {
      if (reachable.has(s.inicio) && !reachable.has(s.fin)) {
        reachable.add(s.fin);
        changed = true;
      }
    });
  }

  if (reachable.size !== nodes.size) {
    return { valid: false, message: 'La red contiene nodos desconectados' };
  }
  return { valid: true };
}

function calculateLE(longitud) {
  return parseFloat((longitud * 1.2).toFixed(2));
}

function calculatePressureLoss(caudal, le, diametro) {
  const deltaP = 23200 * 0.67 * caudal * Math.pow(le, 1.82) * Math.pow(diametro, -4.82);
  return parseFloat(deltaP.toFixed(4));
}

function calculateVelocity(caudal, diametro, pi) {
  const velocidad = 345 * caudal * Math.pow((pi/1000) + 0.7236, -1) * Math.pow(diametro, -2);
  return parseFloat(velocidad.toFixed(2));
}

function checkSegmentStatus(segment) {
  const isVelocityValid = segment.velocidad <= 10;
  const isPressureLossValid = segment.deltaP <= (0.1 * segment.pi);
  return isVelocityValid && isPressureLossValid ?
    { status: "✅ Aprobado", class: "approved-row" } :
    { status: "❌ Rechazado", class: "rejected-row" };
}

function updatePiField() {
  const piField = document.getElementById('pi');
  if (segments.length === 0 || editingIndex === 0) {
    piField.readOnly = false;
    piField.classList.remove('pi-field');
    if (editingIndex !== 0) {
      piField.value = '';
    }
  } else {
    piField.readOnly = true;
    piField.classList.add('pi-field');
    piField.value = nextPiValue ? nextPiValue.toFixed(2) : '';
  }
}

function addSegment() {
  const form = document.getElementById('segmentForm');
  if (!form.checkValidity()) {
    form.classList.add('was-validated');
    return;
  }
  const segment = {
    inicio: sanitizeNodeName(document.getElementById('inicio').value.trim()),
    fin: sanitizeNodeName(document.getElementById('fin').value.trim()),
    caudal: parseFloat(document.getElementById('caudal').value),
    longitud: parseFloat(document.getElementById('longitud').value),
    diametro: parseFloat(document.getElementById('diametro').value),
    pi: parseFloat(document.getElementById('pi').value),
    material: document.getElementById('material').value
  };
  const validation = validateSegment(segment);
  if (!validation.valid) {
    showAlert(validation.message, 'danger');
    return;
  }
  if (editingIndex >= 0) {
    segments[editingIndex] = segment;
    editingIndex = -1;
    document.getElementById('addBtn').innerHTML = '<i class="bi bi-plus-circle"></i> Agregar Tramo';
    showAlert('Tramo actualizado correctamente', 'success');
  } else {
    const exists = segments.some(s => s.inicio === segment.inicio && s.fin === segment.fin);
    if (exists) {
      showAlert('Este tramo ya existe en la red', 'warning');
      return;
    }
    segments.push(segment);
    showAlert('Tramo agregado correctamente', 'success');
  }
  clearForm();
  calculateNetwork();
}

function clearForm() {
  document.getElementById('inicio').value = '';
  document.getElementById('fin').value = '';
  document.getElementById('caudal').value = '';
  document.getElementById('longitud').value = '';
  document.getElementById('diametro').value = '';
  document.getElementById('material').value = 'PE AL PE';
  document.getElementById('segmentForm').classList.remove('was-validated');
  document.getElementById('addBtn').innerHTML = '<i class="bi bi-plus-circle"></i> Agregar Tramo';
  editingIndex = -1;
  updatePiField();
  document.getElementById('inicio').focus();
}

function clearAll() {
  showConfirm('¿Está seguro de eliminar todos los datos, incluyendo cliente y cálculos?', function() {
    segments = [];
    nextPiValue = null;
    currentClient = null;
    localStorage.removeItem('currentGasClient');
    document.getElementById('clientForm').reset();
    document.getElementById('clientForm').classList.remove('was-validated');
    document.getElementById('clientSummary').style.display = 'none';
    document.querySelector('#resultsTable tbody').innerHTML = '';
    document.getElementById('summarySection').style.display = 'none';
    if (pressureChart) {
      pressureChart.destroy();
      pressureChart = null;
    }
    clearForm();
    showAlert('Todos los datos han sido eliminados', 'info');
  });
}

function editSegment(index) {
  const segment = segments[index];
  editingIndex = index;
  document.getElementById('inicio').value = segment.inicio;
  document.getElementById('fin').value = segment.fin;
  document.getElementById('caudal').value = segment.caudal;
  document.getElementById('longitud').value = segment.longitud;
  document.getElementById('diametro').value = segment.diametro;
  document.getElementById('pi').value = segment.pi;
  document.getElementById('material').value = segment.material;
  document.getElementById('addBtn').innerHTML = '<i class="bi bi-save"></i> Guardar Cambios';
  const rows = document.querySelectorAll('#resultsTable tbody tr');
  rows.forEach(row => row.classList.remove('editing-row'));
  if (rows[index]) rows[index].classList.add('editing-row');
  updatePiField();
  document.getElementById('inicio').focus();
}

function deleteSegment(index) {
  showConfirm('¿Está seguro de eliminar este tramo?', function() {
    segments.splice(index, 1);
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      const le = calculateLE(lastSegment.longitud);
      const deltaP = calculatePressureLoss(lastSegment.caudal, le, lastSegment.diametro);
      nextPiValue = lastSegment.pi - deltaP;
    } else {
      nextPiValue = null;
    }
    calculateNetwork();
    showAlert('Tramo eliminado correctamente', 'info');
  });
}

function topologicalSort(segments) {
  const graph = new Map();
  const inDegree = new Map();
  segments.forEach(s => {
    if (!graph.has(s.inicio)) graph.set(s.inicio, []);
    graph.get(s.inicio).push(s.fin);
    inDegree.set(s.fin, (inDegree.get(s.fin) || 0) + 1);
    if (!inDegree.has(s.inicio)) inDegree.set(s.inicio, 0);
  });
  const queue = [];
  inDegree.forEach((degree, node) => {
    if (degree === 0) queue.push(node);
  });
  const sortedNodes = [];
  while (queue.length > 0) {
    const node = queue.shift();
    sortedNodes.push(node);
    if (graph.has(node)) {
      graph.get(node).forEach(neighbor => {
        inDegree.set(neighbor, inDegree.get(neighbor) - 1);
        if (inDegree.get(neighbor) === 0) queue.push(neighbor);
      });
    }
  }
  if (sortedNodes.length !== inDegree.size) {
    throw new Error('Network contains a cycle');
  }
  return segments.sort((a, b) => sortedNodes.indexOf(a.inicio) - sortedNodes.indexOf(b.inicio));
}

function calculateNetwork() {
  if (segments.length === 0) {
    document.getElementById('summarySection').style.display = 'none';
    if (pressureChart) {
      pressureChart.destroy();
      pressureChart = null;
    }
    return;
  }
  const validation = validateNetwork(segments);
  if (!validation.valid) {
    showAlert(validation.message, 'danger');
    return;
  }
  const tbody = document.querySelector('#resultsTable tbody');
  tbody.innerHTML = '';
  nodePressures.clear();
  document.getElementById('summarySection').style.display = 'block';
  const sortedSegments = topologicalSort([...segments]);
  if (sortedSegments.length > 0) {
    nodePressures.set(sortedSegments[0].inicio, sortedSegments[0].pi);
  }
  const chartData = {
    labels: [],
    pressures: [],
    velocities: []
  };
  let totalDeltaP = 0;
  let maxVelocity = 0;
  let approvedCount = 0;
  let initialPressure = sortedSegments[0]?.pi || 0;
  sortedSegments.forEach((segment, index) => {
    const initialNodePressure = nodePressures.get(segment.inicio) || segment.pi;
    const le = calculateLE(segment.longitud);
    const deltaP = calculatePressureLoss(segment.caudal, le, segment.diametro);
    const pf = initialNodePressure - deltaP;
    const velocidad = calculateVelocity(segment.caudal, segment.diametro, initialNodePressure);
    const status = checkSegmentStatus({
      velocidad: velocidad,
      deltaP: deltaP,
      pi: initialNodePressure
    });
    totalDeltaP += deltaP;
    if (velocidad > maxVelocity) maxVelocity = velocidad;
    if (status.class === "approved-row") approvedCount++;
    nodePressures.set(segment.fin, pf);
    chartData.labels.push(`${segment.inicio}-${segment.fin}`);
    chartData.pressures.push(pf);
    chartData.velocities.push(velocidad);
    const tr = document.createElement('tr');
    tr.className = status.class;
    if (index === editingIndex) tr.classList.add('editing-row');
    tr.innerHTML = `
      <td>${segment.inicio}</td>
      <td>${segment.fin}</td>
      <td>${segment.caudal.toFixed(2)}</td>
      <td>${segment.longitud.toFixed(2)}</td>
      <td>${le.toFixed(2)}</td>
      <td>${segment.diametro.toFixed(2)}</td>
      <td>${initialNodePressure.toFixed(2)}</td>
      <td>${deltaP.toFixed(4)}</td>
      <td>${pf.toFixed(2)}</td>
      <td>${velocidad.toFixed(2)}</td>
      <td>${segment.material}</td>
      <td>${status.status}</td>
      <td class="text-nowrap">
        <button class="btn btn-sm btn-outline-primary btn-action me-1" onclick="editSegment(${index})">
          <i class="bi bi-pencil"></i> Editar
        </button>
        <button class="btn btn-sm btn-outline-danger btn-action" onclick="deleteSegment(${index})">
          <i class="bi bi-trash"></i> Eliminar
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  const finalPressure = sortedSegments.length > 0 ?
    nodePressures.get(sortedSegments[sortedSegments.length-1].fin) : 0;
  document.getElementById('summaryPi').textContent = initialPressure.toFixed(2);
  document.getElementById('summaryPf').textContent = finalPressure.toFixed(2);
  document.getElementById('summaryDeltaP').textContent = totalDeltaP.toFixed(2);
  document.getElementById('summaryPercent').textContent = initialPressure ? ((totalDeltaP / initialPressure) * 100).toFixed(2) : '0.00';
  document.getElementById('summaryMaxVel').textContent = maxVelocity.toFixed(2);
  document.getElementById('summaryApproved').textContent = approvedCount;
  document.getElementById('summaryTotal').textContent = segments.length;
  const generalStatus = approvedCount === segments.length ?
    '<span class="text-success">✅ APROBADO</span>' :
    '<span class="text-danger">❌ REQUIERE AJUSTES</span>';
  document.getElementById('summaryStatus').innerHTML = generalStatus;
  if (segments.length > 0) {
    nextPiValue = finalPressure;
    updatePiField();
  }
  updateChart(chartData);
}

function updateChart(data) {
  const ctx = document.getElementById('pressureChart').getContext('2d');
  if (pressureChart) {
    pressureChart.destroy();
  }
  pressureChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [
        {
          label: 'Presión (mbar)',
          data: data.pressures,
          borderColor: '#e53935',
          backgroundColor: 'rgba(229, 57, 53, 0.1)',
          borderWidth: 2,
          yAxisID: 'y',
          tension: 0.3
        },
        {
          label: 'Velocidad (m/s)',
          data: data.velocities,
          borderColor: '#3949ab',
          backgroundColor: 'rgba(57, 73, 171, 0.1)',
          borderWidth: 2,
          yAxisID: 'y1',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        title: {
          display: true,
          text: 'Perfil de Presión y Velocidad',
          font: { size: 16 }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          title: { display: true, text: 'Presión (mbar)' },
          min: data.pressures.length ? Math.max(0, Math.min(...data.pressures) - 5) : 0
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          title: { display: true, text: 'Velocidad (m/s)' },
          grid: { drawOnChartArea: false },
          min: 0,
          max: data.velocities.length ? Math.max(10, Math.max(...data.velocities) + 2) : 12
        }
      }
    }
  });
}

function exportToPDF() {
  if (segments.length === 0) {
    showAlert('No hay datos para exportar', 'warning');
    return;
  }
  if (!currentClient) {
    showAlert('Complete los datos del cliente primero', 'warning');
    new bootstrap.Tab(document.getElementById('client-tab')).show();
    return;
  }

  // Crear documento PDF en orientación horizontal
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;

  // 1. Encabezado
  doc.setFontSize(16);
  doc.setTextColor(40);
  doc.text('TODO GAS SYR S.A.S', pageWidth / 2, 15, { align: 'center' });
  doc.setFontSize(12);
  doc.text('Cálculo de Red de Gas - Informe Técnico', pageWidth / 2, 22, { align: 'center' });
  doc.setFontSize(10);
  doc.text(`NIT: 901.126.243-3 | Fecha: ${new Date().toLocaleDateString('es-CO', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  })}`, pageWidth / 2, 28, { align: 'center' });

  // 2. Datos del cliente
  doc.setFontSize(12);
  doc.text('Datos del Cliente:', margin, 38);
  doc.setFontSize(10);
  
  // Organizar datos del cliente en columnas
  const clientData = [
    [`Nombre: ${currentClient.name}`, `Identificación: ${currentClient.type} ${currentClient.id}`],
    [`Dirección: ${currentClient.address}`, `Teléfono: ${currentClient.phone}`],
    [`Municipio: ${currentClient.city}`, `Email: ${currentClient.email || 'N/A'}`],
    [`Departamento: ${currentClient.department}`, `Tipo de Proyecto: ${currentClient.projectType}`],
    ['', `Tipo de Gas: ${currentClient.gasType}`]
  ];
  
  let clientY = 45;
  clientData.forEach(row => {
    doc.text(row[0], margin, clientY);
    doc.text(row[1], pageWidth / 2, clientY);
    clientY += 5;
  });

  // 3. Resumen técnico
  doc.setFontSize(12);
  doc.text('Resumen Técnico:', margin, clientY + 10);
  doc.setFontSize(10);
  
  const summaryData = [
    [`Presión inicial: ${document.getElementById('summaryPi').textContent} mbar`, 
     `Presión final: ${document.getElementById('summaryPf').textContent} mbar`],
    [`Pérdida total: ${document.getElementById('summaryDeltaP').textContent} mbar (${document.getElementById('summaryPercent').textContent}%)`, 
     `Velocidad máxima: ${document.getElementById('summaryMaxVel').textContent} m/s`],
    [`Tramos aprobados: ${document.getElementById('summaryApproved').textContent}/${document.getElementById('summaryTotal').textContent}`, 
     `Estado general: ${document.getElementById('summaryStatus').textContent.includes('APROBADO') ? 'APROBADO' : 'REQUIERE AJUSTES'}`]
  ];
  
  let summaryY = clientY + 17;
  summaryData.forEach(row => {
    doc.text(row[0], margin, summaryY);
    doc.text(row[1], pageWidth / 2, summaryY);
    summaryY += 5;
  });

  // 4. Tabla de resultados
  const headers = [
    'Inicio', 
    'Fin', 
    'Caudal (m³/h)', 
    'Longitud (m)', 
    'LE (m)', 
    'Diámetro (mm)',
    'Pi (mbar)',
    'Pérdida (mbar)',
    'Pf (mbar)',
    'Velocidad (m/s)',
    'Material',
    'Estado'
  ];

  const rows = segments.map((s, i) => {
    const le = calculateLE(s.longitud);
    const deltaP = calculatePressureLoss(s.caudal, le, s.diametro);
    const pf = nodePressures.get(s.fin);
    const velocidad = calculateVelocity(s.caudal, s.diametro, s.pi);
    const estado = velocidad <= 10 && deltaP <= (0.1 * s.pi) ? 'Aprobado' : 'Rechazado';
    
    return [
      s.inicio,
      s.fin,
      s.caudal.toFixed(2),
      s.longitud.toFixed(2),
      le.toFixed(2),
      s.diametro.toFixed(2),
      s.pi.toFixed(2),
      deltaP.toFixed(4),
      pf.toFixed(2),
      velocidad.toFixed(2),
      s.material,
      estado
    ];
  });

  // Configuración de la tabla
  doc.autoTable({
    startY: summaryY + 10,
    head: [headers],
    body: rows,
    margin: { left: margin, right: margin },
    styles: { 
      fontSize: 7, 
      cellPadding: 1.5,
      overflow: 'linebreak',
      halign: 'center'
    },
    headStyles: { 
      fillColor: [229, 57, 53], 
      textColor: 255, 
      fontSize: 8,
      halign: 'center'
    },
    alternateRowStyles: { 
      fillColor: [245, 245, 245] 
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 'auto' },
      4: { cellWidth: 'auto' },
      5: { cellWidth: 'auto' },
      6: { cellWidth: 'auto' },
      7: { cellWidth: 'auto' },
      8: { cellWidth: 'auto' },
      9: { cellWidth: 'auto' },
      10: { cellWidth: 'auto' },
      11: { cellWidth: 'auto' }
    },
    didDrawPage: function(data) {
      // Número de página
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(`Página ${doc.internal.getNumberOfPages()}`, pageWidth - margin, pageHeight - 5);
    }
  });

  // 5. Agregar gráfico
  const canvas = document.getElementById('pressureChart');
  const canvasImg = canvas.toDataURL('image/png');
  const imgWidth = pageWidth - 2 * margin;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  
  // Verificar espacio disponible
  const currentY = doc.lastAutoTable.finalY || 110;
  const spaceNeeded = imgHeight + 20;
  
  if (currentY + spaceNeeded > pageHeight - 20) {
    doc.addPage();
    doc.addImage(canvasImg, 'PNG', margin, 10, imgWidth, imgHeight);
  } else {
    doc.addImage(canvasImg, 'PNG', margin, currentY + 10, imgWidth, imgHeight);
  }

  // 6. Pie de página
  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + imgHeight + 20 : pageHeight - 20;
  doc.setFontSize(10);
  doc.text('Diseñado por: Polidoro Saavedra', margin, finalY);
  doc.text('CC 4.121.669 | Registro SENA 1300196', margin, finalY + 5);
  doc.text(`Versión 1.0.1 | Generado el: ${new Date().toLocaleString('es-CO')}`, margin, finalY + 10);

  // 7. Guardar PDF
  const fileName = `Informe_${currentClient.name.replace(/[^a-z0-9]/gi, '_')}_${new Date().getTime()}.pdf`;
  doc.save(fileName);
  showAlert('PDF exportado correctamente', 'success');
}

function showAlert(message, type) {
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
  alertDiv.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
  document.body.appendChild(alertDiv);
  setTimeout(() => {
    alertDiv.classList.remove('show');
    setTimeout(() => alertDiv.remove(), 150);
  }, 5000);
}

function showConfirm(message, callback) {
  document.getElementById('confirmModalBody').textContent = message;
  const confirmBtn = document.getElementById('confirmModalBtn');
  confirmBtn.replaceWith(confirmBtn.cloneNode(true));
  const newConfirmBtn = document.getElementById('confirmModalBtn');
  newConfirmBtn.onclick = function() {
    confirmModal.hide();
    callback();
  };
  confirmModal.show();
}