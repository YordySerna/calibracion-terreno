/* Calibración Forestal — lógica de la app.
   Cubicación JAS + metro ruma + reporte diario + historial con export a Excel. */
(function () {
  'use strict';

  /* ================= Norma JAS ================= */

  // Largos de la tabla de terreno: nominal (para el volumen) y real (con sobredimensión).
  var LARGOS = [
    { nom: 2.5, real: 2.5 },
    { nom: 3.2, real: 3.3 },
    { nom: 4.0, real: 4.1 },
    { nom: 5.0, real: 5.1 },
    { nom: 6.0, real: 6.1 },
    { nom: 7.0, real: 7.1 },
    { nom: 8.0, real: 8.1 }
  ];

  // Clases diamétricas de la tabla: 16 a 80 cm, de 2 en 2.
  var DIAMETROS = [];
  for (var d = 16; d <= 80; d += 2) DIAMETROS.push(d);

  // Volumen JAS de un trozo. d en cm, largo nominal en m.
  function volumenJAS(d, largo) {
    if (!(d > 0) || !(largo > 0)) return 0;
    if (largo < 6) return d * d * largo / 10000;
    var ajustado = d + (Math.floor(largo) - 4) / 2;
    return ajustado * ajustado * largo / 10000;
  }

  /* ================= Estado y persistencia ================= */

  var CLAVE = 'calibracionForestal_v1';

  function estadoNuevo() {
    return {
      actual: {
        fecha: hoyISO(),
        faena: '',
        maquina: '',
        novedades: '',
        // Cada cancha lleva su conteo { "3.2": { "18": 46, ... } } y sus rumas.
        canchas: [{ nombre: 'Cancha 1', conteo: {}, rumas: [] }],
        canchaActiva: 0,
        juntarTotal: false
      },
      historial: []
    };
  }

  function cargar() {
    try {
      var crudo = localStorage.getItem(CLAVE);
      if (!crudo) return null;
      var e = JSON.parse(crudo);
      if (!e || !e.actual) return null;
      // Migración: versiones anteriores tenían un solo conteo, sin canchas.
      if (!e.actual.canchas) {
        e.actual.canchas = [{ nombre: 'Cancha 1', conteo: e.actual.conteo || {} }];
        delete e.actual.conteo;
        e.actual.canchaActiva = 0;
      }
      if (!(e.actual.canchaActiva >= 0) || e.actual.canchaActiva >= e.actual.canchas.length) {
        e.actual.canchaActiva = 0;
      }
      // Migración: las rumas eran una lista global; ahora viven en cada cancha.
      for (var i = 0; i < e.actual.canchas.length; i++) {
        if (!e.actual.canchas[i].rumas) e.actual.canchas[i].rumas = [];
      }
      if (e.actual.rumas && e.actual.rumas.length) {
        e.actual.canchas[0].rumas = e.actual.canchas[0].rumas.concat(e.actual.rumas);
      }
      delete e.actual.rumas;
      return e;
    } catch (err) {
      return null;
    }
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(estado));
    } catch (err) {
      // Sin espacio o modo privado: la app sigue funcionando, solo no persiste.
    }
  }

  var estado = cargar() || estadoNuevo();
  var largoActivo = 0; // índice en LARGOS

  function hoyISO() {
    var f = new Date();
    return f.getFullYear() + '-' +
      String(f.getMonth() + 1).padStart(2, '0') + '-' +
      String(f.getDate()).padStart(2, '0');
  }

  /* ================= Utilidades ================= */

  function $(id) { return document.getElementById(id); }

  function fmt(n, dec) {
    return Number(n).toLocaleString('es-CL', {
      minimumFractionDigits: dec, maximumFractionDigits: dec
    });
  }

  function fmtLargo(l) { return fmt(l, 2); }

  function numeroDesdeTexto(t) {
    if (t === null || t === undefined) return NaN;
    return parseFloat(String(t).trim().replace(',', '.'));
  }

  function fechaLegible(iso) {
    if (!iso) return '';
    var partes = iso.split('-');
    if (partes.length !== 3) return iso;
    var f = new Date(+partes[0], +partes[1] - 1, +partes[2]);
    return f.toLocaleDateString('es-CL', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
  }

  /* ================= Totales ================= */

  function totalesLargo(conteo, indiceLargo) {
    var L = LARGOS[indiceLargo];
    var porDiam = conteo[String(L.nom)] || {};
    var n = 0, m3 = 0;
    for (var i = 0; i < DIAMETROS.length; i++) {
      var cant = porDiam[String(DIAMETROS[i])] || 0;
      n += cant;
      m3 += cant * volumenJAS(DIAMETROS[i], L.nom);
    }
    return { n: n, m3: m3 };
  }

  function totalesConteo(conteo) {
    var n = 0, m3 = 0;
    for (var i = 0; i < LARGOS.length; i++) {
      var t = totalesLargo(conteo, i);
      n += t.n;
      m3 += t.m3;
    }
    return { n: n, m3: m3 };
  }

  // Lista de canchas de un registro; los guardados antiguos tenían un solo conteo.
  function canchasDe(datos) {
    if (datos.canchas) return datos.canchas;
    return [{ nombre: '', conteo: datos.conteo || {} }];
  }

  function conteoActivo() {
    return estado.actual.canchas[estado.actual.canchaActiva].conteo;
  }

  // Suma los conteos de todas las canchas en uno solo (para totales generales).
  function combinarConteos(datos) {
    var lista = canchasDe(datos), comb = {}, c, lg, d;
    for (c = 0; c < lista.length; c++) {
      for (lg in lista[c].conteo) {
        if (!comb[lg]) comb[lg] = {};
        for (d in lista[c].conteo[lg]) {
          comb[lg][d] = (comb[lg][d] || 0) + lista[c].conteo[lg][d];
        }
      }
    }
    return comb;
  }

  // Método MR: la ruma se mide por su cara (largo × alto promedio). No se
  // convierte a m³: el MR se informa tal cual.
  function altoPromedio(r) {
    var suma = 0;
    for (var i = 0; i < r.altos.length; i++) suma += r.altos[i];
    return r.altos.length ? suma / r.altos.length : 0;
  }

  function mrDeRuma(r) {
    return r.largo * altoPromedio(r);
  }

  function totalMR(rumas) {
    var t = 0;
    for (var i = 0; i < rumas.length; i++) t += mrDeRuma(rumas[i]);
    return t;
  }

  // Rumas agrupadas por cancha; soporta guardados antiguos con lista suelta.
  function rumasPorCancha(datos) {
    var lista = canchasDe(datos), i;
    var conRumas = false;
    for (i = 0; i < lista.length; i++) {
      if (lista[i].rumas && lista[i].rumas.length) conRumas = true;
    }
    if (!conRumas && datos.rumas && datos.rumas.length) {
      return [{ nombre: '', rumas: datos.rumas }];
    }
    var salida = [];
    for (i = 0; i < lista.length; i++) {
      salida.push({ nombre: lista[i].nombre, rumas: lista[i].rumas || [] });
    }
    return salida;
  }

  function resumenDe(datos) {
    var tc = totalesConteo(combinarConteos(datos));
    var grupos = rumasPorCancha(datos);
    var rumasN = 0, mrT = 0;
    for (var i = 0; i < grupos.length; i++) {
      rumasN += grupos[i].rumas.length;
      mrT += totalMR(grupos[i].rumas);
    }
    return {
      trozos: tc.n,
      m3: tc.m3,
      rumas: rumasN,
      mr: mrT
    };
  }

  /* ================= Pestañas ================= */

  var botonesTab = document.querySelectorAll('.tabs button');
  for (var bi = 0; bi < botonesTab.length; bi++) {
    botonesTab[bi].addEventListener('click', function () {
      var destino = this.getAttribute('data-panel');
      var i;
      for (i = 0; i < botonesTab.length; i++) botonesTab[i].classList.remove('activa');
      this.classList.add('activa');
      var paneles = document.querySelectorAll('.panel');
      for (i = 0; i < paneles.length; i++) paneles[i].classList.remove('activa');
      $('panel-' + destino).classList.add('activa');
      if (destino === 'reporte') pintarProduccion();
      if (destino === 'historial') pintarHistorial();
      window.scrollTo(0, 0);
    });
  }

  /* ================= Calculadora rápida ================= */

  function calcularRapida() {
    var d = numeroDesdeTexto($('calcDiam').value);
    var l = numeroDesdeTexto($('calcLargo').value);
    if (!(d > 0) || !(l > 0)) {
      $('calcRes').textContent = 'Ingresa diámetro y largo';
      return;
    }
    var v = volumenJAS(d, l);
    $('calcRes').textContent = 'V = ' + fmt(Math.round(v * 1000) / 1000, 3) + ' m³';
  }
  $('calcDiam').addEventListener('input', calcularRapida);
  $('calcLargo').addEventListener('input', calcularRapida);

  /* ================= Conteo JAS ================= */

  function pintarCanchas() {
    var canchas = estado.actual.canchas;
    var html = '';
    for (var i = 0; i < canchas.length; i++) {
      var t = totalesConteo(canchas[i].conteo);
      var nRumas = (canchas[i].rumas || []).length;
      var detalle = [];
      if (t.n) detalle.push(t.n + ' trozos');
      if (nRumas) detalle.push(nRumas + (nRumas === 1 ? ' ruma' : ' rumas'));
      html += '<button type="button" data-indice="' + i + '"' +
        (i === estado.actual.canchaActiva ? ' class="activa"' : '') + '>' +
        escaparHTML(canchas[i].nombre) +
        '<small>' + (detalle.length ? detalle.join(' · ') : 'vacía') + '</small>' +
        '</button>';
    }
    html += '<button type="button" data-accion="nueva">＋ Cancha<small>agregar</small></button>';
    $('chipsCancha').innerHTML = html;
    $('chipsCanchaMR').innerHTML = html;
  }

  function manejarClickCancha(ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    if (btn.getAttribute('data-accion') === 'nueva') {
      var nombre = prompt('Nombre de la cancha nueva:', 'Cancha ' + (estado.actual.canchas.length + 1));
      if (nombre === null) return;
      nombre = nombre.trim() || ('Cancha ' + (estado.actual.canchas.length + 1));
      estado.actual.canchas.push({ nombre: nombre, conteo: {}, rumas: [] });
      estado.actual.canchaActiva = estado.actual.canchas.length - 1;
    } else {
      var i = +btn.getAttribute('data-indice');
      if (i === estado.actual.canchaActiva) {
        var actual = estado.actual.canchas[i];
        var nuevo = prompt('Nombre de la cancha:', actual.nombre);
        if (nuevo === null) return;
        actual.nombre = nuevo.trim() || actual.nombre;
      } else {
        estado.actual.canchaActiva = i;
      }
    }
    guardar();
    pintarCanchas();
    pintarChips();
    pintarGrid();
    pintarRumas();
  }

  $('chipsCancha').addEventListener('click', manejarClickCancha);
  $('chipsCanchaMR').addEventListener('click', manejarClickCancha);

  $('btnEliminarCancha').addEventListener('click', function () {
    var canchas = estado.actual.canchas;
    if (canchas.length === 1) {
      alert('Es la única cancha: para partir de cero usa «Vaciar el conteo de esta cancha».');
      return;
    }
    var actual = canchas[estado.actual.canchaActiva];
    if (!confirm('¿Eliminar «' + actual.nombre + '» con su conteo y sus rumas? Esto no borra lo ya guardado en el historial.')) return;
    canchas.splice(estado.actual.canchaActiva, 1);
    estado.actual.canchaActiva = 0;
    guardar();
    pintarCanchas();
    pintarChips();
    pintarGrid();
    pintarRumas();
  });

  function pintarChips() {
    var html = '';
    for (var i = 0; i < LARGOS.length; i++) {
      var L = LARGOS[i];
      var t = totalesLargo(conteoActivo(), i);
      html += '<button type="button" data-indice="' + i + '"' +
        (i === largoActivo ? ' class="activa"' : '') + '>' +
        fmtLargo(L.real) + ' m' +
        '<small>' + (t.n ? t.n + ' trozos' : 'cubica ' + fmtLargo(L.nom)) + '</small>' +
        '</button>';
    }
    $('chipsLargo').innerHTML = html;
  }

  $('chipsLargo').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    largoActivo = +btn.getAttribute('data-indice');
    pintarChips();
    pintarGrid();
  });

  function pintarGrid() {
    var L = LARGOS[largoActivo];
    var porDiam = conteoActivo()[String(L.nom)] || {};
    var html = '';
    for (var i = 0; i < DIAMETROS.length; i++) {
      var diam = DIAMETROS[i];
      var cant = porDiam[String(diam)] || 0;
      var m3 = cant * volumenJAS(diam, L.nom);
      html += '<div class="fila-diam' + (cant ? ' con-trozos' : '') + '" data-diam="' + diam + '">' +
        '<span class="diam">' + diam + '</span>' +
        '<button type="button" class="menos" aria-label="Quitar trozo de ' + diam + ' cm">−</button>' +
        '<input class="cuenta" type="text" inputmode="numeric" pattern="[0-9]*" value="' + cant + '" aria-label="Trozos de ' + diam + ' cm">' +
        '<button type="button" class="mas" aria-label="Sumar trozo de ' + diam + ' cm">+</button>' +
        '<span class="m3">' + (cant ? fmt(m3, 3) : '') + '</span>' +
        '</div>';
    }
    $('gridConteo').innerHTML = html;
    pintarResumen();
  }

  // Fija la cantidad de una clase diamétrica y actualiza solo la fila tocada
  // y los resúmenes. escribirCampo=false cuando el cambio viene del propio
  // input, para no pisar lo que el usuario está tipeando.
  function fijarCuenta(fila, cant, escribirCampo) {
    var diam = fila.getAttribute('data-diam');
    var L = LARGOS[largoActivo];
    var claveLargo = String(L.nom);
    var conteo = conteoActivo();
    if (!conteo[claveLargo]) conteo[claveLargo] = {};
    var porDiam = conteo[claveLargo];
    if (!(cant > 0)) { cant = 0; delete porDiam[diam]; }
    else porDiam[diam] = cant;
    guardar();

    var m3 = cant * volumenJAS(+diam, L.nom);
    if (escribirCampo) fila.querySelector('.cuenta').value = cant;
    fila.querySelector('.m3').textContent = cant ? fmt(m3, 3) : '';
    fila.classList.toggle('con-trozos', cant > 0);
    pintarCanchas();
    pintarChips();
    pintarResumen();
  }

  function cuentaDe(fila) {
    var L = LARGOS[largoActivo];
    var porDiam = conteoActivo()[String(L.nom)] || {};
    return porDiam[fila.getAttribute('data-diam')] || 0;
  }

  $('gridConteo').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    var fila = btn.closest('.fila-diam');
    var cant = cuentaDe(fila) + (btn.classList.contains('mas') ? 1 : -1);
    fijarCuenta(fila, cant, true);
  });

  // Tipear la cantidad directo en el campo (para no apretar + trescientas veces).
  $('gridConteo').addEventListener('input', function (ev) {
    if (!ev.target.classList.contains('cuenta')) return;
    // Campo vacío = todavía no escribe nada: se conserva la cantidad guardada.
    if (ev.target.value.trim() === '') return;
    var n = parseInt(ev.target.value, 10);
    if (!(n >= 0)) n = 0;
    if (n > 99999) n = 99999;
    fijarCuenta(ev.target.closest('.fila-diam'), n, false);
  });

  // Al tocar el campo se vacía al tiro: se tipea la cantidad sin borrar nada.
  // La cantidad guardada no cambia hasta que se escribe algo.
  $('gridConteo').addEventListener('focusin', function (ev) {
    if (!ev.target.classList.contains('cuenta')) return;
    ev.target.value = '';
  });

  // Al salir del campo vuelve a mostrarse la cantidad guardada
  // (si se tipeó algo ya quedó tomada; si no, se restaura la que había).
  $('gridConteo').addEventListener('focusout', function (ev) {
    if (!ev.target.classList.contains('cuenta')) return;
    ev.target.value = cuentaDe(ev.target.closest('.fila-diam'));
  });

  // Enter cierra el teclado del teléfono.
  $('gridConteo').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target.classList.contains('cuenta')) ev.target.blur();
  });

  function pintarResumen() {
    var canchas = estado.actual.canchas;
    var varias = canchas.length > 1;
    var html = '<tr><th>Largo</th><th>Trozos</th><th>M³ JAS</th></tr>';
    var totN = 0, totM3 = 0, hayAlgo = false;
    for (var c = 0; c < canchas.length; c++) {
      var tc = totalesConteo(canchas[c].conteo);
      totN += tc.n;
      totM3 += tc.m3;
      if (varias) {
        html += '<tr class="cancha"><td>' + escaparHTML(canchas[c].nombre) + '</td>' +
          '<td>' + tc.n + '</td><td>' + fmt(tc.m3, 3) + '</td></tr>';
      }
      for (var i = 0; i < LARGOS.length; i++) {
        var t = totalesLargo(canchas[c].conteo, i);
        if (!t.n) continue;
        hayAlgo = true;
        html += '<tr><td>' + (varias ? '· ' : '') + fmtLargo(LARGOS[i].real) + ' m</td>' +
          '<td>' + t.n + '</td><td>' + fmt(t.m3, 3) + '</td></tr>';
      }
    }
    if (!hayAlgo && !varias) {
      html += '<tr><td colspan="3" class="vacio">Aún no hay trozos contados</td></tr>';
    }
    html += '<tr class="total"><td>TOTAL</td><td>' + totN + '</td>' +
      '<td>' + fmt(totM3, 3) + '</td></tr>';
    $('tablaResumen').innerHTML = html;
  }

  $('btnVaciarConteo').addEventListener('click', function () {
    var nombre = estado.actual.canchas[estado.actual.canchaActiva].nombre;
    if (!confirm('¿Vaciar el conteo de «' + nombre + '»? Esto no borra lo ya guardado en el historial.')) return;
    estado.actual.canchas[estado.actual.canchaActiva].conteo = {};
    guardar();
    pintarCanchas();
    pintarChips();
    pintarGrid();
  });

  /* ================= Metro ruma ================= */

  // Altos de la ruma en curso: se van acumulando con el botón ＋.
  var altosTemp = [];

  function pintarAltos() {
    if (!altosTemp.length) {
      $('altosAcumulados').innerHTML = 'Sin altos agregados aún.';
      return;
    }
    var suma = 0;
    for (var i = 0; i < altosTemp.length; i++) suma += altosTemp[i];
    $('altosAcumulados').innerHTML =
      'Altos: <strong>' + altosTemp.map(function (a) { return fmt(a, 2); }).join(' · ') +
      '</strong> — promedio ' + fmt(suma / altosTemp.length, 2) + ' m' +
      '<button type="button" class="btn-quitar-alto" id="btnQuitarAlto">↩ quitar último</button>';
  }

  function agregarAlto() {
    var a = numeroDesdeTexto($('mrAlto').value);
    if (!(a > 0)) { alert('Escribe un alto válido, ej: 2,1'); return; }
    altosTemp.push(a);
    $('mrAlto').value = '';
    $('mrAlto').focus();
    pintarAltos();
  }

  $('btnAgregarAlto').addEventListener('click', agregarAlto);
  $('mrAlto').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); agregarAlto(); }
  });
  $('altosAcumulados').addEventListener('click', function (ev) {
    if (ev.target.id !== 'btnQuitarAlto') return;
    altosTemp.pop();
    pintarAltos();
  });

  $('btnAgregarRuma').addEventListener('click', function () {
    var largo = numeroDesdeTexto($('mrLargo').value);
    var altos = altosTemp.slice();
    // Si escribió un alto y no alcanzó a apretar ＋, se toma igual.
    var pendiente = numeroDesdeTexto($('mrAlto').value);
    if (pendiente > 0) altos.push(pendiente);
    if (!(largo > 0)) { alert('Falta el largo de la ruma.'); return; }
    if (!altos.length) { alert('Falta al menos un alto: escríbelo y apreta ＋.'); return; }

    var canchaRuma = estado.actual.canchas[estado.actual.canchaActiva];
    if (!canchaRuma.rumas) canchaRuma.rumas = [];
    canchaRuma.rumas.push({ largo: largo, altos: altos });
    guardar();
    altosTemp = [];
    $('mrLargo').value = '';
    $('mrAlto').value = '';
    pintarAltos();
    pintarCanchas();
    pintarRumas();
  });

  function pintarRumas() {
    var canchas = estado.actual.canchas;
    var varias = canchas.length > 1;
    var html = '<tr><th>N°</th><th>Largo</th><th>Alto prom.</th><th>MR</th><th></th></tr>';
    var totalRumas = 0, totalMr = 0;
    for (var c = 0; c < canchas.length; c++) {
      var rumas = canchas[c].rumas || [];
      totalRumas += rumas.length;
      totalMr += totalMR(rumas);
      if (varias && rumas.length) {
        html += '<tr class="cancha"><td colspan="3">' + escaparHTML(canchas[c].nombre) + '</td>' +
          '<td>' + fmt(totalMR(rumas), 2) + '</td><td></td></tr>';
      }
      for (var i = 0; i < rumas.length; i++) {
        var r = rumas[i];
        html += '<tr><td>' + (i + 1) + '</td>' +
          '<td>' + fmt(r.largo, 2) + '</td>' +
          '<td>' + fmt(altoPromedio(r), 2) + '</td>' +
          '<td>' + fmt(mrDeRuma(r), 2) + '</td>' +
          '<td><button type="button" class="btn-mini" data-cancha="' + c + '" data-indice="' + i + '">✕</button></td></tr>';
      }
    }
    if (!totalRumas) {
      html += '<tr><td colspan="5" class="vacio">Aún no hay rumas</td></tr>';
    }
    $('tablaRumas').innerHTML = html;
    $('totalMR').textContent = totalRumas
      ? 'Total: ' + fmt(totalMr, 2) + ' MR (' + totalRumas + (totalRumas === 1 ? ' ruma)' : ' rumas)')
      : 'Sin rumas registradas';
  }

  $('tablaRumas').addEventListener('click', function (ev) {
    var btn = ev.target.closest('.btn-mini');
    if (!btn) return;
    var c = +btn.getAttribute('data-cancha');
    var i = +btn.getAttribute('data-indice');
    if (!confirm('¿Eliminar la ruma N° ' + (i + 1) + ' de «' + estado.actual.canchas[c].nombre + '»?')) return;
    estado.actual.canchas[c].rumas.splice(i, 1);
    guardar();
    pintarCanchas();
    pintarRumas();
  });

  /* ================= Reporte diario ================= */

  var camposReporte = { repFecha: 'fecha', repFaena: 'faena', repMaquina: 'maquina', repNovedades: 'novedades' };
  Object.keys(camposReporte).forEach(function (id) {
    $(id).addEventListener('input', function () {
      estado.actual[camposReporte[id]] = this.value;
      guardar();
    });
  });

  function pintarReporte() {
    $('repFecha').value = estado.actual.fecha;
    $('repFaena').value = estado.actual.faena;
    $('repMaquina').value = estado.actual.maquina;
    $('repNovedades').value = estado.actual.novedades;
    $('chkJuntarTotal').checked = !!estado.actual.juntarTotal;
    pintarProduccion();
  }

  function pintarProduccion() {
    var r = resumenDe(estado.actual);
    var canchas = estado.actual.canchas;
    var varias = canchas.length > 1;
    var html =
      '<tr><td>Trozos cubicados (JAS)</td><td>' + r.trozos + '</td></tr>' +
      '<tr><td>Volumen JAS</td><td>' + fmt(r.m3, 3) + ' m³</td></tr>';
    if (varias) {
      for (var c = 0; c < canchas.length; c++) {
        var tc = totalesConteo(canchas[c].conteo);
        html += '<tr><td>&nbsp;&nbsp;· ' + escaparHTML(canchas[c].nombre) + ' (' + tc.n + ' trozos)</td>' +
          '<td>' + fmt(tc.m3, 3) + ' m³</td></tr>';
      }
    }
    html += '<tr><td>Metro ruma</td><td>' + fmt(r.mr, 2) + ' MR (' + r.rumas +
      (r.rumas === 1 ? ' ruma' : ' rumas') + ')</td></tr>';
    if (varias && r.rumas) {
      for (var g = 0; g < canchas.length; g++) {
        var rumasC = canchas[g].rumas || [];
        if (!rumasC.length) continue;
        html += '<tr><td>&nbsp;&nbsp;· ' + escaparHTML(canchas[g].nombre) + ' (' + rumasC.length +
          (rumasC.length === 1 ? ' ruma' : ' rumas') + ')</td>' +
          '<td>' + fmt(totalMR(rumasC), 2) + ' MR</td></tr>';
      }
    }
    if (estado.actual.juntarTotal && r.mr > 0) {
      html += '<tr class="total"><td>Total general (m³ + MR)</td><td>' + fmt(r.m3 + r.mr, 2) + '</td></tr>';
    }
    $('tablaProduccion').innerHTML = html;
  }

  $('chkJuntarTotal').addEventListener('change', function () {
    estado.actual.juntarTotal = this.checked;
    guardar();
    pintarProduccion();
  });

  $('btnGuardarDia').addEventListener('click', function () {
    var r = resumenDe(estado.actual);
    if (!r.trozos && !r.rumas && !estado.actual.novedades.trim()) {
      alert('No hay nada que guardar todavía: cuenta trozos, registra rumas o escribe las novedades.');
      return;
    }
    var copia = JSON.parse(JSON.stringify(estado.actual));
    copia.id = Date.now();
    copia.guardadoEl = new Date().toISOString();
    copia.tot = r;
    estado.historial.unshift(copia);

    var limpiar = confirm('Calibración guardada en el historial ✔\n\n¿Quieres limpiar las canchas, las rumas y las novedades para empezar una nueva?');
    if (limpiar) {
      estado.actual.canchas = [{ nombre: 'Cancha 1', conteo: {}, rumas: [] }];
      estado.actual.canchaActiva = 0;
      estado.actual.novedades = '';
      estado.actual.fecha = hoyISO();
      pintarCanchas();
      pintarChips();
      pintarGrid();
      pintarRumas();
      pintarReporte();
    }
    guardar();
    pintarHistorial();
  });

  /* ================= Exportar a Excel ================= */

  function nombreArchivo(datos) {
    var base = 'calibracion_' + (datos.fecha || hoyISO());
    if (datos.maquina) {
      base += '_' + datos.maquina.trim().toLowerCase()
        .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
        .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 30);
    }
    return base + '.xlsx';
  }

  function hojasDe(datos) {
    var r = datos.tot || resumenDe(datos);
    var listaCanchas = canchasDe(datos);
    var varias = listaCanchas.length > 1;
    var i, j;

    // --- Hoja Reporte ---
    var filasReporte = [
      [{ v: 'REPORTE DIARIO DE CALIBRACIÓN FORESTAL', s: 1 }],
      [],
      [{ v: 'Fecha', s: 1 }, datos.fecha || ''],
      [{ v: 'Faena / Predio', s: 1 }, datos.faena || ''],
      [{ v: 'Máquina', s: 1 }, datos.maquina || ''],
      [],
      [{ v: 'PRODUCCIÓN DEL DÍA', s: 1 }],
      [{ v: 'Trozos cubicados (JAS)', s: 0 }, r.trozos],
      [{ v: 'Volumen JAS (m³)', s: 0 }, { v: r.m3, s: 2 }]
    ];
    if (varias) {
      for (i = 0; i < listaCanchas.length; i++) {
        var tCancha = totalesConteo(listaCanchas[i].conteo);
        filasReporte.push([
          { v: '   · ' + (listaCanchas[i].nombre || ('Cancha ' + (i + 1))) + ' — ' + tCancha.n + ' trozos', s: 0 },
          { v: tCancha.m3, s: 2 }
        ]);
      }
    }
    filasReporte.push([{ v: 'Metro ruma (MR)', s: 0 }, { v: r.mr, s: 2 }]);
    var gruposMR = rumasPorCancha(datos);
    if (varias && r.rumas) {
      for (i = 0; i < gruposMR.length; i++) {
        if (!gruposMR[i].rumas.length) continue;
        filasReporte.push([
          { v: '   · ' + (gruposMR[i].nombre || 'Sin cancha') + ' — ' + gruposMR[i].rumas.length +
            (gruposMR[i].rumas.length === 1 ? ' ruma' : ' rumas'), s: 0 },
          { v: totalMR(gruposMR[i].rumas), s: 2 }
        ]);
      }
    }
    if (datos.juntarTotal && r.mr > 0) {
      filasReporte.push([{ v: 'TOTAL GENERAL (m³ + MR)', s: 1 }, { v: r.m3 + r.mr, s: 3 }]);
    }
    filasReporte.push([]);
    filasReporte.push([{ v: 'NOVEDADES DEL DÍA', s: 1 }]);
    filasReporte.push([{ v: datos.novedades || 'Sin novedades.', s: 4 }]);

    var hojas = [{ nombre: 'Reporte', anchos: [34, 18], filas: filasReporte }];

    // --- Hoja Cubicación JAS: una tabla por cancha, como la planilla de terreno ---
    function filaEncabezadoJAS() {
      var fila = [{ v: 'DIÁM (cm)', s: 1 }];
      for (var k = 0; k < LARGOS.length; k++) {
        fila.push({ v: 'N° ' + LARGOS[k].real.toFixed(2).replace('.', ',') + ' m', s: 1 });
        fila.push({ v: 'M³', s: 1 });
      }
      fila.push({ v: 'TOTAL N°', s: 1 });
      fila.push({ v: 'TOTAL M³', s: 1 });
      return fila;
    }

    function filaTotalJAS(conteo, etiqueta) {
      var fila = [{ v: etiqueta, s: 1 }];
      var granN = 0, granM3 = 0;
      for (var k = 0; k < LARGOS.length; k++) {
        var t = totalesLargo(conteo, k);
        granN += t.n;
        granM3 += t.m3;
        fila.push({ v: t.n, s: 1 });
        fila.push({ v: t.m3, s: 3 });
      }
      fila.push({ v: granN, s: 1 });
      fila.push({ v: granM3, s: 3 });
      return fila;
    }

    var filasJAS = [];
    for (var c = 0; c < listaCanchas.length; c++) {
      var conteo = listaCanchas[c].conteo;
      if (varias || listaCanchas[c].nombre) {
        filasJAS.push([{ v: 'CANCHA: ' + (listaCanchas[c].nombre || (c + 1)), s: 1 }]);
      }
      filasJAS.push(filaEncabezadoJAS());
      for (i = 0; i < DIAMETROS.length; i++) {
        var diam = DIAMETROS[i];
        var fila = [diam];
        var totN = 0, totM3 = 0;
        for (j = 0; j < LARGOS.length; j++) {
          var porDiam = conteo[String(LARGOS[j].nom)] || {};
          var cant = porDiam[String(diam)] || 0;
          var m3 = cant * volumenJAS(diam, LARGOS[j].nom);
          totN += cant;
          totM3 += m3;
          fila.push(cant || '');
          fila.push(cant ? { v: m3, s: 2 } : '');
        }
        fila.push(totN || '');
        fila.push(totN ? { v: totM3, s: 2 } : '');
        filasJAS.push(fila);
      }
      filasJAS.push(filaTotalJAS(conteo, varias ? 'TOTAL CANCHA' : 'TOTAL'));
      filasJAS.push([]);
    }
    if (varias) {
      filasJAS.push(filaTotalJAS(combinarConteos(datos), 'TOTAL GENERAL'));
      filasJAS.push([]);
    }
    filasJAS.push(['Los largos se informan con sobredimensión; el volumen usa el largo nominal de la tabla JAS (ej: 3,30 cubica como 3,20).']);

    var anchosJAS = [12];
    for (i = 0; i < LARGOS.length; i++) { anchosJAS.push(10); anchosJAS.push(9); }
    anchosJAS.push(10); anchosJAS.push(10);
    hojas.push({ nombre: 'Cubicación JAS', anchos: anchosJAS, filas: filasJAS });

    // --- Hoja MR: rumas agrupadas por cancha ---
    var filasMR = [[
      { v: 'N° ruma', s: 1 }, { v: 'Cancha', s: 1 }, { v: 'Largo (m)', s: 1 },
      { v: 'Altos medidos (m)', s: 1 }, { v: 'Alto prom. (m)', s: 1 }, { v: 'MR', s: 1 }
    ]];
    for (i = 0; i < gruposMR.length; i++) {
      var grupo = gruposMR[i];
      for (j = 0; j < grupo.rumas.length; j++) {
        var ruma = grupo.rumas[j];
        filasMR.push([
          j + 1,
          grupo.nombre || '',
          { v: ruma.largo, s: 2 },
          ruma.altos.map(function (a) { return String(a).replace('.', ','); }).join(' · '),
          { v: altoPromedio(ruma), s: 2 },
          { v: mrDeRuma(ruma), s: 2 }
        ]);
      }
      if (varias && grupo.rumas.length) {
        filasMR.push([{ v: 'Subtotal', s: 1 }, { v: grupo.nombre || '', s: 1 }, '', '', '', { v: totalMR(grupo.rumas), s: 3 }]);
      }
    }
    filasMR.push([{ v: 'TOTAL', s: 1 }, '', '', '', '', { v: r.mr, s: 3 }]);
    filasMR.push([]);
    filasMR.push(['Método: la ruma se mide por su cara. MR = largo × alto promedio.']);
    hojas.push({ nombre: 'Metro ruma', anchos: [9, 18, 11, 24, 13, 10], filas: filasMR });

    return hojas;
  }

  function descargar(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  }

  $('btnExcelDia').addEventListener('click', function () {
    descargar(MiniXLSX.crear(hojasDe(estado.actual)), nombreArchivo(estado.actual));
  });

  // Compartir el Excel directo (WhatsApp, correo…) donde el navegador lo permita.
  function puedeCompartirArchivos() {
    if (!navigator.canShare) return false;
    try {
      var prueba = new File(['x'], 'prueba.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      return navigator.canShare({ files: [prueba] });
    } catch (err) {
      return false;
    }
  }

  if (puedeCompartirArchivos()) {
    $('btnCompartirExcel').hidden = false;
    $('btnCompartirExcel').addEventListener('click', function () {
      var blob = MiniXLSX.crear(hojasDe(estado.actual));
      var archivo = new File([blob], nombreArchivo(estado.actual), { type: blob.type });
      navigator.share({ files: [archivo], title: 'Calibración forestal' }).catch(function () {});
    });
  }

  function textoReporte(datos) {
    var r = datos.tot || resumenDe(datos);
    var lineas = [
      '📋 REPORTE DIARIO — ' + fechaLegible(datos.fecha),
      ''
    ];
    if (datos.faena) lineas.push('Faena: ' + datos.faena);
    if (datos.maquina) lineas.push('Máquina: ' + datos.maquina);

    // Cada cancha con su desglose por producto (largo) y su total.
    var listaCanchas = canchasDe(datos);
    for (var c = 0; c < listaCanchas.length; c++) {
      var cancha = listaCanchas[c];
      var tc = totalesConteo(cancha.conteo);
      if (!tc.n) continue;
      var nombre = cancha.nombre || ('Cancha ' + (c + 1));
      lineas.push('');
      lineas.push('🪵 ' + nombre + ':');
      for (var i = 0; i < LARGOS.length; i++) {
        var t = totalesLargo(cancha.conteo, i);
        if (!t.n) continue;
        lineas.push('• ' + fmtLargo(LARGOS[i].real) + ' m: ' + t.n + ' trozos — ' + fmt(t.m3, 3) + ' m³');
      }
      lineas.push('Total ' + nombre + ': ' + tc.n + ' trozos — ' + fmt(tc.m3, 3) + ' m³');
    }

    // Metro ruma separado por cancha.
    if (r.rumas) {
      var grupos = rumasPorCancha(datos);
      var conRumas = [];
      for (var g = 0; g < grupos.length; g++) {
        if (grupos[g].rumas.length) conRumas.push(grupos[g]);
      }
      lineas.push('');
      if (conRumas.length > 1) {
        lineas.push('📐 Metro ruma:');
        for (g = 0; g < conRumas.length; g++) {
          lineas.push('• ' + (conRumas[g].nombre || 'Sin cancha') + ': ' +
            fmt(totalMR(conRumas[g].rumas), 2) + ' MR (' + conRumas[g].rumas.length +
            (conRumas[g].rumas.length === 1 ? ' ruma)' : ' rumas)'));
        }
        lineas.push('Total MR: ' + fmt(r.mr, 2) + ' MR');
      } else {
        lineas.push('📐 Metro ruma: ' + fmt(r.mr, 2) + ' MR (' + r.rumas +
          (r.rumas === 1 ? ' ruma)' : ' rumas)'));
      }
    }

    lineas.push('');
    if (datos.juntarTotal && r.mr > 0) {
      lineas.push('✅ Total general: ' + fmt(r.m3 + r.mr, 2));
    } else {
      lineas.push('✅ Total general canchas: ' + fmt(r.m3, 3) + ' m³');
      if (r.mr > 0) {
        lineas.push('✅ Total del día: ' + fmt(r.m3, 3) + ' m³ + ' + fmt(r.mr, 2) + ' MR');
      }
    }
    lineas.push('');
    lineas.push('📝 Novedades:');
    lineas.push(datos.novedades.trim() || 'Sin novedades.');
    return lineas.join('\n');
  }

  $('btnCompartirTexto').addEventListener('click', function () {
    var texto = textoReporte(estado.actual);
    if (navigator.share) {
      navigator.share({ text: texto }).catch(function () {});
    } else {
      window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
    }
  });

  /* ================= Historial ================= */

  function pintarHistorial() {
    var h = estado.historial;
    if (!h.length) {
      $('listaHistorial').innerHTML = '<p class="vacio">Todavía no hay calibraciones guardadas.<br>Se guardan desde la pestaña Reporte.</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < h.length; i++) {
      var it = h[i];
      var r = it.tot;
      html += '<div class="item-historial" data-id="' + it.id + '">' +
        '<h3>' + fechaLegible(it.fecha) + '</h3>' +
        '<p class="meta">' +
        (it.faena ? it.faena + (it.maquina ? ' · ' : '') : '') +
        (it.maquina || '') + '</p>' +
        '<p class="cifras">' + r.trozos + ' trozos · ' + fmt(r.m3, 3) + ' m³ JAS' +
        (r.rumas ? ' · ' + fmt(r.mr, 2) + ' MR' : '') + '</p>' +
        (it.novedades.trim() ? '<p class="novedades">' + escaparHTML(it.novedades) + '</p>' : '') +
        '<div class="botones">' +
        '<button type="button" class="btn" data-accion="excel">📊 Excel</button>' +
        '<button type="button" class="btn" data-accion="compartir">💬 Compartir</button>' +
        '<button type="button" class="btn peligro" data-accion="eliminar">🗑</button>' +
        '</div></div>';
    }
    $('listaHistorial').innerHTML = html;
  }

  function escaparHTML(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  $('listaHistorial').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button');
    if (!btn) return;
    var id = +btn.closest('.item-historial').getAttribute('data-id');
    var indice = -1;
    for (var i = 0; i < estado.historial.length; i++) {
      if (estado.historial[i].id === id) { indice = i; break; }
    }
    if (indice < 0) return;
    var it = estado.historial[indice];
    var accion = btn.getAttribute('data-accion');

    if (accion === 'excel') {
      descargar(MiniXLSX.crear(hojasDe(it)), nombreArchivo(it));
    } else if (accion === 'compartir') {
      var texto = textoReporte(it);
      if (navigator.share) navigator.share({ text: texto }).catch(function () {});
      else window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
    } else if (accion === 'eliminar') {
      if (!confirm('¿Eliminar la calibración del ' + fechaLegible(it.fecha) + '? Esta acción no se puede deshacer.')) return;
      estado.historial.splice(indice, 1);
      guardar();
      pintarHistorial();
    }
  });

  $('btnExcelTodo').addEventListener('click', function () {
    if (!estado.historial.length) {
      alert('Todavía no hay calibraciones guardadas.');
      return;
    }
    var filas = [[
      { v: 'Fecha', s: 1 }, { v: 'Faena / Predio', s: 1 }, { v: 'Máquina', s: 1 },
      { v: 'Trozos', s: 1 }, { v: 'M³ JAS', s: 1 },
      { v: 'Rumas', s: 1 }, { v: 'MR', s: 1 }, { v: 'Novedades', s: 1 }
    ]];
    var totTrozos = 0, totM3 = 0, totMRr = 0;
    for (var i = estado.historial.length - 1; i >= 0; i--) {
      var it = estado.historial[i];
      totTrozos += it.tot.trozos;
      totM3 += it.tot.m3;
      totMRr += it.tot.mr;
      filas.push([
        it.fecha, it.faena, it.maquina,
        it.tot.trozos, { v: it.tot.m3, s: 2 },
        it.tot.rumas, { v: it.tot.mr, s: 2 },
        { v: it.novedades || '', s: 4 }
      ]);
    }
    filas.push([
      { v: 'TOTAL', s: 1 }, '', '',
      { v: totTrozos, s: 1 }, { v: totM3, s: 3 },
      '', { v: totMRr, s: 3 }, ''
    ]);
    var blob = MiniXLSX.crear([{
      nombre: 'Resumen',
      anchos: [12, 22, 22, 9, 10, 8, 8, 60],
      filas: filas
    }]);
    descargar(blob, 'historial_calibraciones.xlsx');
  });

  /* ================= Arranque ================= */

  $('fechaCabecera').textContent = new Date().toLocaleDateString('es-CL', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  if (!estado.actual.fecha) estado.actual.fecha = hoyISO();

  pintarCanchas();
  pintarChips();
  pintarGrid();
  pintarAltos();
  pintarRumas();
  pintarReporte();
  pintarHistorial();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
