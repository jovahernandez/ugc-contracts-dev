// src/services/githubStorageService.ts
// Servicio para persistir datos en GitHub como commits automáticos

interface GitHubFileContent {
  sha?: string;
  content?: string;
  encoding?: string;
}

interface CommitResult {
  success: boolean;
  message: string;
  sha?: string;
  url?: string;
}

/**
 * Configuración de GitHub desde variables de entorno
 */
function getGitHubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || 'another-ugc-contracts';
  const owner = process.env.GITHUB_OWNER || 'another-company'; // Ajustar al owner real
  const branch = process.env.GITHUB_BRANCH || 'main';
  
  return { token, repo, owner, branch };
}

/**
 * Verifica si GitHub Storage está configurado
 */
export function isGitHubStorageEnabled(): boolean {
  const { token } = getGitHubConfig();
  return !!token;
}

/**
 * Obtiene el contenido de un archivo desde GitHub
 */
async function getFileFromGitHub(filePath: string): Promise<GitHubFileContent | null> {
  const { token, repo, owner, branch } = getGitHubConfig();
  
  if (!token) return null;
  
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'another-ugc-contracts',
      },
    });
    
    if (response.status === 404) {
      return null; // Archivo no existe
    }
    
    if (!response.ok) {
      console.error('GitHub API error:', response.status, await response.text());
      return null;
    }
    
    return await response.json();
  } catch (err) {
    console.error('Error fetching file from GitHub:', err);
    return null;
  }
}

/**
 * Guarda o actualiza un archivo en GitHub mediante commit
 */
export async function saveToGitHub(
  filePath: string,
  content: string | object,
  commitMessage: string
): Promise<CommitResult> {
  const { token, repo, owner, branch } = getGitHubConfig();
  
  if (!token) {
    return {
      success: false,
      message: 'GitHub token not configured (GITHUB_TOKEN env var)',
    };
  }
  
  try {
    // Convertir contenido a string si es objeto
    const contentString = typeof content === 'object' 
      ? JSON.stringify(content, null, 2) 
      : content;
    
    // Codificar en base64
    const contentBase64 = Buffer.from(contentString, 'utf-8').toString('base64');
    
    // Verificar si el archivo ya existe para obtener su SHA
    const existingFile = await getFileFromGitHub(filePath);
    
    // Preparar el payload
    const payload: any = {
      message: commitMessage,
      content: contentBase64,
      branch,
    };
    
    // Si el archivo existe, incluir SHA para actualizar
    if (existingFile?.sha) {
      payload.sha = existingFile.sha;
    }
    
    // Hacer el commit
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'another-ugc-contracts',
      },
      body: JSON.stringify(payload),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('GitHub commit failed:', response.status, errorText);
      return {
        success: false,
        message: `GitHub API error: ${response.status}`,
      };
    }
    
    const result = await response.json();
    
    console.log(`✅ GitHub commit successful: ${filePath}`);
    
    return {
      success: true,
      message: 'File committed to GitHub',
      sha: result.commit?.sha,
      url: result.content?.html_url,
    };
    
  } catch (err: any) {
    console.error('Error saving to GitHub:', err);
    return {
      success: false,
      message: err.message || 'Unknown error',
    };
  }
}

/**
 * Lee un archivo JSON desde GitHub
 */
export async function loadFromGitHub<T>(filePath: string): Promise<T | null> {
  const { token } = getGitHubConfig();
  
  if (!token) return null;
  
  try {
    const file = await getFileFromGitHub(filePath);
    
    if (!file?.content) return null;
    
    // Decodificar base64
    const content = Buffer.from(file.content, 'base64').toString('utf-8');
    
    return JSON.parse(content) as T;
  } catch (err) {
    console.error('Error loading from GitHub:', err);
    return null;
  }
}

/**
 * Guarda un registro de declaración en GitHub (en path predecible para lookup)
 * Guarda en dos ubicaciones: by-uid y by-token para permitir búsqueda por ambos
 */
export async function saveDeclaracionToGitHub(
  uid: string,
  data: any
): Promise<CommitResult> {
  // Guardar por UID (principal)
  const filePathByUid = `data/declaraciones/by-uid/${uid}.json`;
  const commitMessage = `📝 Declaración: ${uid} - ${new Date().toLocaleString('es-MX')}`;

  const result = await saveToGitHub(filePathByUid, data, commitMessage);

  // Si tiene token, también guardar por token para lookup rápido
  if (data.token) {
    const filePathByToken = `data/declaraciones/by-token/${data.token}.json`;
    const commitMessageToken = `🔗 Declaración por token: ${data.token} -> ${uid}`;

    // Guardar en paralelo (no bloqueante)
    saveToGitHub(filePathByToken, data, commitMessageToken).catch(err => {
      console.warn(`⚠️ No se pudo guardar en GitHub por token: ${err.message}`);
    });
  }

  return result;
}

/**
 * Carga un registro de declaración desde GitHub por UID
 * Intenta primero el path nuevo, luego busca en formato legacy (fecha_uid.json)
 */
export async function loadDeclaracionFromGitHub(uid: string): Promise<any | null> {
  // 1. Intentar path nuevo
  const filePath = `data/declaraciones/by-uid/${uid}.json`;
  let record = await loadFromGitHub(filePath);

  if (record) {
    return record;
  }

  // 2. Intentar path legacy (formato: YYYY-MM-DD_UID.json)
  // Buscar en commits recientes que contengan el UID
  console.log(`[Legacy Path] Buscando ${uid} en formato legacy...`);

  try {
    const { token, repo, owner, branch } = getGitHubConfig();
    if (!token) return null;

    // Listar archivos en el directorio raíz de declaraciones
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/data/declaraciones?ref=${branch}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'another-ugc-contracts',
      },
    });

    if (response.ok) {
      const files = await response.json();

      // Buscar archivo que termine con _UID.json
      const legacyFile = files.find((f: any) =>
        f.name.endsWith(`_${uid}.json`) && f.type === 'file'
      );

      if (legacyFile) {
        console.log(`✅ [Legacy Path] Encontrado: ${legacyFile.name}`);
        const legacyPath = `data/declaraciones/${legacyFile.name}`;
        record = await loadFromGitHub(legacyPath);

        if (record) {
          return record;
        }
      }
    }
  } catch (err) {
    console.error(`Error buscando en legacy path:`, err);
  }

  return null;
}

/**
 * Carga un registro de declaración desde GitHub por token
 */
export async function loadDeclaracionFromGitHubByToken(token: string): Promise<any | null> {
  const filePath = `data/declaraciones/by-token/${token}.json`;
  return loadFromGitHub(filePath);
}

/**
 * Guarda todos los registros pendientes en un archivo índice
 */
export async function saveDeclaracionesIndex(
  records: object[]
): Promise<CommitResult> {
  const filePath = 'data/declaraciones/index.json';
  const commitMessage = `🔄 Actualizar índice de declaraciones - ${new Date().toLocaleString('es-MX')}`;
  
  return saveToGitHub(filePath, records, commitMessage);
}

/**
 * Carga el índice de declaraciones desde GitHub
 */
export async function loadDeclaracionesIndex<T>(): Promise<T[] | null> {
  return loadFromGitHub<T[]>('data/declaraciones/index.json');
}
