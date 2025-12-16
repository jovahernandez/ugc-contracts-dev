// src/utils/amountToWords.ts

/**
 * Convierte un número (monto en MXN) a letras en español,
 * solo la parte entera, sin "PESOS", sin "M.N.", sin centavos.
 *
 * Ejemplos:
 *  - 0    -> "CERO"
 *  - 15   -> "QUINCE"
 *  - 21   -> "VEINTIUNO"
 *  - 2300 -> "DOS MIL TRESCIENTOS"
 */
export function montoMxEnLetras(monto: number): string {
  if (!Number.isFinite(monto)) {
    throw new Error('Monto inválido');
  }

  const entero = Math.floor(Math.abs(monto));

  if (entero === 0) {
    return 'CERO';
  }

  const letras = numeroEnteroEnLetras(entero).toUpperCase().trim();

  // Aseguramos que no haya "Y " al inicio por seguridad
  const sinYInicial = letras.replace(/^Y\s+/i, '').trim();

  return sinYInicial;
}

function numeroEnteroEnLetras(n: number): string {
  if (n === 0) return '';

  if (n < 1000) {
    return centenasALetras(n);
  }

  if (n < 1_000_000) {
    // miles
    const miles = Math.floor(n / 1000);
    const resto = n % 1000;
    let texto = '';

    if (miles === 1) {
      texto = 'MIL';
    } else {
      texto = `${centenasALetras(miles)} MIL`;
    }

    if (resto > 0) {
      texto += ` ${centenasALetras(resto)}`;
    }

    return texto;
  }

  if (n < 1_000_000_000) {
    // millones
    const millones = Math.floor(n / 1_000_000);
    const resto = n % 1_000_000;
    let texto = '';

    if (millones === 1) {
      texto = 'UN MILLON';
    } else {
      texto = `${centenasALetras(millones)} MILLONES`;
    }

    if (resto > 0) {
      texto += ` ${numeroEnteroEnLetras(resto)}`;
    }

    return texto;
  }

  // Si necesitas más de 999,999,999 puedes extender esto,
  // pero para contratos usuales suele ser suficiente.
  return centenasALetras(n);
}

function centenasALetras(n: number): string {
  const unidades = [
    '',
    'UNO',
    'DOS',
    'TRES',
    'CUATRO',
    'CINCO',
    'SEIS',
    'SIETE',
    'OCHO',
    'NUEVE',
    'DIEZ',
    'ONCE',
    'DOCE',
    'TRECE',
    'CATORCE',
    'QUINCE',
  ];

  const decenasEspeciales = [
    'DIECISEIS',
    'DIECISIETE',
    'DIECIOCHO',
    'DIECINUEVE',
  ]; // 16-19

  const decenas = [
    '',
    'DIEZ',
    'VEINTE',
    'TREINTA',
    'CUARENTA',
    'CINCUENTA',
    'SESENTA',
    'SETENTA',
    'OCHENTA',
    'NOVENTA',
  ];

  const centenas = [
    '',
    'CIENTO',
    'DOSCIENTOS',
    'TRESCIENTOS',
    'CUATROCIENTOS',
    'QUINIENTOS',
    'SEISCIENTOS',
    'SETECIENTOS',
    'OCHOCIENTOS',
    'NOVECIENTOS',
  ];

  if (n === 0) return '';
  if (n === 100) return 'CIEN';

  const c = Math.floor(n / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;

  let resultado = '';

  if (c > 0) {
    resultado += centenas[c];
  }

  const resto = n % 100;

  if (resto > 0) {
    if (resultado) resultado += ' ';

    if (resto <= 15) {
      // 1 - 15
      resultado += unidades[resto];
    } else if (resto < 20) {
      // 16 - 19
      resultado += decenasEspeciales[resto - 16];
    } else if (resto === 20) {
      resultado += 'VEINTE';
    } else if (resto > 20 && resto < 30) {
      // 21 - 29
      resultado += 'VEINTI' + unidades[u].toLowerCase();
      resultado = resultado.toUpperCase();
    } else {
      // 30,40,50,...,90 + unidades
      resultado += decenas[d];
      if (u > 0) {
        resultado += ` Y ${unidades[u]}`;
      }
    }
  }

  return resultado.trim();
}
