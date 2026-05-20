/**
 * =================================================================================
 * ARQUIVO DE SCRIPT GLOBAL - VITRINE VIRTUAL (VERSÃO GITHUB PAGES)
 * =================================================================================
 * Este arquivo contém toda a lógica de:
 * 1. Conexão com o Banco de Dados (Google Sheets API via fetch)
 * 2. Sistema de Cache (LocalStorage)
 * 3. Renderização da Vitrine (Lista de Produtos)
 * 4. Sistema de Filtros Avançados (Busca Facetada)
 * 5. Navegação e Página de Detalhes do Produto (PDP)
 * 6. Integração com WhatsApp
 * 7. Correção de Imagens do Google Drive
 * 8. Galeria de Zoom em Tela Cheia
 * =================================================================================
 */

/**
 * =================================================================================
 * 0. CONFIGURAÇÕES E VARIÁVEIS GLOBAIS
 * =================================================================================
 */

// ⚠️ IMPORTANTE: Cole aqui a URL do seu Web App gerado no Google Apps Script!
const API_URL = "https://script.google.com/macros/s/AKfycbxlpEKlzTXTLqk5GM4Thkjs8OmCSHyA9v6J_mHG5yChfMqQhLc1_rr4U7hkpREz9WM0sg/exec"; 

let bancoDeDados = []; // Repositório central de produtos carregados do servidor.
let carrinho = []; // Lista de itens selecionados pelo usuário para compra.
let categoriaAtivaTopo = null; // Armazena a categoria selecionada nos filtros superiores.

const CHAVE_CARRINHO = "cache_carrinho_v1"; // Chave de identificação para o armazenamento do carrinho no LocalStorage.
const CHAVE_CACHE = "cache_vitrine_loja_full_v8"; // Chave de identificação para o cache da vitrine de produtos.
const IMG_CONFIG = { // Define as rotas e extensões para o carregamento de imagens locais.
  basePath: 'https://fitney.com.br/img',
  thumbsFolder: 'PRODUTOS_THUMBS',
  zoomFolder: 'PRODUTOS_ZOOM',
  extensao: '.webp' // Altere para .jpg ou .png se suas imagens locais usarem outro formato
};

/**=================================================================================*/


/**
 * =================================================================================
 * 1. UTILITÁRIOS E CONVERSORES
 * =================================================================================
 */

function verDetalhesProduto(sku) {
  // ... sua lógica de abrir o modal ou tela ...
  
  // ATUALIZA O LINK: Faz o SKU aparecer na barra de endereços
  window.history.pushState({ view: 'pdp', id: sku }, "", "?p=" + sku);
}

// E na função que limpa/volta para a home:
function voltarParaHomeOriginal() {
  // ... sua lógica de fechar produto ...
  
  // LIMPA O LINK: Remove o ?p=SKU da barra de endereços
  window.history.pushState({ view: 'home' }, "", window.location.pathname);
}


// Converte valores monetários formatados em números decimais para cálculos.
function v2n(valor) {
  if (typeof valor === 'number') {
    return valor;
  }
  
  if (!valor) {
    return 0;
  }

  // Remove caracteres não numéricos, exceto vírgula e ponto
  var stringLimpa = String(valor)
    .replace("R$", "")       // Tira o símbolo da moeda
    .replace(/\s/g, "")      // Tira espaços em branco
    .replace(/\./g, "")      // Tira os pontos de milhar
    .replace(",", ".")       // Troca a vírgula decimal por ponto
    .trim();                 // Remove espaços nas pontas

  var numeroFinal = parseFloat(stringLimpa);
  
  // Se der erro na conversão (NaN), retorna 0
  if (isNaN(numeroFinal)) {
    return 0;
  }
  
  return numeroFinal;
}

// Formata números decimais para o padrão de moeda brasileiro (R$)
function n2v(valor) {
  if (valor === undefined || valor === null || isNaN(valor)) {
    return "0,00";
  }
  // Agora ela já retorna com R$, ponto de milhar e vírgula decimal
  return Number(valor).toLocaleString('pt-BR', { 
    style: 'currency', 
    currency: 'BRL',
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
}

// Escapa caracteres especiais em IDs para evitar quebras no HTML.
function safeId(id) {
  return String(id)
    .replace(/'/g, "\\'")   // Escapa aspas simples
    .replace(/"/g, '&quot;');// Escapa aspas duplas
}


// Gerencia a lógica de carregamento híbrido entre servidor local e Google Drive.
/**
 * Gera os atributos 'src' e 'onerror' para o carregamento híbrido.
 * @param {string} idProduto - ID da pasta do produto
 * @param {string} urlDrive - Link de backup do Google Drive
 * @param {boolean} ehZoom - Define se carrega thumb ou zoom
 * @param {string} idOtimizado - O nome do arquivo vindo do novo campo do BD
 */
function obterAtributosImagem(idProduto, urlDrive, ehZoom, idOtimizado) {
  // 1. Se não houver dados, retorna o placeholder
  if (!idOtimizado && !urlDrive) {
    return `src="https://via.placeholder.com/400x500?text=Sem+Foto"`;
  }

  // 2. Gera a URL de Backup (Google Drive)
  var urlBackup = processarImg(urlDrive, ehZoom);

  // 3. Tenta o carregamento pelo Servidor Local (Fitney)
  if (idOtimizado) {
    // Define a pasta base (PRODUTOS_THUMBS ou PRODUTOS_ZOOM)
    var pastaRaiz = ehZoom ? IMG_CONFIG.zoomFolder : IMG_CONFIG.thumbsFolder;
    
    // NOVO TRATAMENTO: Verifica se idOtimizado é um array (lista) vindo do BD.
    // Se for um array, pegamos o primeiro item (índice 0). Se for string, usamos ela mesma.
    var pathReferencia = Array.isArray(idOtimizado) ? idOtimizado[0] : idOtimizado;
    
    // Limpeza de strings e remoção de barra inicial duplicada para garantir o padrão
    var idLimpo = String(pathReferencia || "").trim();
    if (idLimpo.startsWith('/')) {
        idLimpo = idLimpo.substring(1);
    }
    
    // Validação de segurança: se o ID estiver vazio ou inválido, pula para o backup
    if (!idLimpo || idLimpo === "null" || idLimpo === "undefined") {
      return `src="${urlBackup}"`;
    }

    // Garante que o nome do arquivo termine com .webp (extensão do servidor)
    var caminhoFinal = idLimpo.includes('.') ? idLimpo : idLimpo + IMG_CONFIG.extensao;
    
    // Montagem da URL: https://fitney.com.br/img/PRODUTOS_THUMBS/020/img10.webp
    // CORREÇÃO: Adicionada a barra "/" explícita entre a pastaRaiz e o caminhoFinal para evitar erros de diretório (404)
    var urlLocal = `${IMG_CONFIG.basePath}/${pastaRaiz}/${caminhoFinal}`;
    
    // Retorna: Tenta o local, se der erro (404), pula para o Drive
    return `src="${urlLocal}" onerror="this.onerror=null; this.src='${urlBackup}';"`;
  }

  // 4. Fallback direto para o Drive se o idOtimizado falhar
  return `src="${urlBackup}"`;
}

// Processa e extrai IDs de imagens hospedadas no Google Drive.
function processarImg(url, altaQualidade) {
  if (!url || url.trim() === "") {
    return 'https://via.placeholder.com/400x400?text=Sem+Foto';
  }

  var match = url.match(/(?:id=|\/d\/)([a-zA-Z0-9_-]+)/);
  
  if (match && match[1]) {
    var id = match[1];
    if (altaQualidade) {
      return "https://drive.google.com/thumbnail?id=" + id + "&sz=s4000";
    } else {
      return "https://drive.google.com/thumbnail?id=" + id + "&sz=w1000";
    }
  }
  
  return url;
}

/**=================================================================================*/


/**
 * =================================================================================
 * 2. INICIALIZAÇÃO E SINCRONIZAÇÃO
 * =================================================================================
 */

/**
 * Remove a Splash Screen (Preloader) com efeito de fade-out.
 * LOCALIZAÇÃO: Adicionar ao final do arquivo JavaScript.html
 */
function esconderPreloader() {
  const preloader = document.getElementById('preloader');
  if (preloader) {
    preloader.style.opacity = '0'; // Inicia o fade-out definido no CSS/Style
    setTimeout(function() {
      preloader.style.display = 'none'; // Remove do fluxo visual após a animação
    }, 500); // 500ms bate com o transition do Style no Index
  }
}

// Gerencia o carregamento inicial via cache local e busca novos dados no servidor.
function carregarDadosIniciais() {
  
  const timerSeguranca = setTimeout(function() {
        const msgErro = document.getElementById('msg-timeout');
        const spinner = document.querySelector('.spinner-border');
        if (msgErro && spinner) {
            spinner.classList.add('d-none'); // Para o spinner
            msgErro.classList.remove('d-none'); // Mostra botão de recarregar
        }
    }, 15000);

  // PASSO 1: Tenta carregar do Cache Local (Instantâneo)
  var cacheLocal = localStorage.getItem(CHAVE_CACHE);
  
  if (cacheLocal) {
    console.log("⚡ [SISTEMA] Carregando dados do cache local...");
    try {
      bancoDeDados = JSON.parse(cacheLocal);
      
      // Verifica se o cache tem dados válidos
      if (Array.isArray(bancoDeDados) && bancoDeDados.length > 0) {
        inicializarInterface();
        
        // 🚀 CORREÇÃO UX: Se o cache existe e é válido, mata a tela de carregamento IMEDIATAMENTE!
        // O cliente não precisa esperar a verificação do servidor para começar a navegar.
        esconderPreloader();
      }
    } catch (erro) {
      console.error("Erro ao ler cache:", erro);
      localStorage.removeItem(CHAVE_CACHE);
    }
  }

  // PASSO 2: Conecta com o Backend (MODO SEGURO / BACKGROUND SYNC VIA FETCH)
  fetch(API_URL + "?action=getDadosVitrine")
    .then(res => res.text())
    .then(function(respostaTexto) {
      // INTERRUPÇÃO DO TIMEOUT DE SEGURANÇA: Dados chegaram a tempo.
      if (window.timerSeguranca) clearTimeout(window.timerSeguranca);

      // CORREÇÃO CRUCIAL:
      // O backend agora manda um TEXTO (JSON String) por segurança.
      // Precisamos converter esse texto em Objeto antes de usar.
      try {
        var respostaObjeto = JSON.parse(respostaTexto);
        
        // Log de confirmação de segurança (pode remover depois se quiser)
        if (respostaObjeto.length > 0 && respostaObjeto[0].valorCusto === undefined) {
           console.log("🔒 [SEGURANÇA] Dados blindados recebidos (sem custo).");
        }

        processarRespostaServidor(respostaObjeto);

        // GATILHO PARA SUBIR A CORTINA: Finaliza a Splash Screen
        // (Só fará diferença visual aqui se for o 1º acesso do cliente e não tinha cache)
        esconderPreloader();

      } catch (e) {
        console.error("Erro ao converter os dados do servidor:", e);
        // Garante que a cortina suba para mostrar o erro ou vitrine parcial
        esconderPreloader(); 
      }
    })
    .catch(function(erro) {
      // INTERRUPÇÃO DO TIMEOUT EM CASO DE FALHA DE CONEXÃO
      if (window.timerSeguranca) clearTimeout(window.timerSeguranca);
      esconderPreloader();

      tratarErroConexao(erro);
    });
}

// Compara dados recebidos do servidor com o cache para decidir por atualizações.
function processarRespostaServidor(resposta) {
  // Verifica se o servidor retornou um erro
  if (resposta && resposta.erro) {
    console.error("Erro vindo do servidor:", resposta.erro);
    if (bancoDeDados.length === 0) {
      document.getElementById('vitrine').innerHTML = 
        '<div class="alert alert-danger text-center mt-5">Erro no sistema: ' + resposta.erro + '</div>';
    }
    return;
  }

  // Compara os dados novos com o cache para evitar processamento desnecessário
  var novoJSON = JSON.stringify(resposta);
  var cacheAtual = localStorage.getItem(CHAVE_CACHE);

  if (novoJSON !== cacheAtual) {
    console.log("🔄 [SISTEMA] Novos dados detectados. Atualizando...");
    
    // Salva no cache
    localStorage.setItem(CHAVE_CACHE, novoJSON);
    
    // Atualiza a variável global
    bancoDeDados = resposta;
    
    // Atualiza a tela
    inicializarInterface();
  } else {
    console.log("✅ [SISTEMA] O banco de dados já está atualizado.");
  }
}

// Trata falhas de conexão com o backend e informa o usuário.
function tratarErroConexao(erro) {
  console.error("Falha grave de conexão:", erro);
  if (bancoDeDados.length === 0) {
    document.getElementById('vitrine').innerHTML = 
      '<div class="alert alert-warning text-center mt-5">Não foi possível conectar ao servidor. Verifique sua internet.</div>';
  }
}

// Orquestra a montagem inicial dos filtros, categorias e roteamento da URL.
function inicializarInterface() {
  popularFiltrosDinamicos();
  renderizarChipsCategorias();
  verificarRotaURL();

  // 🚀 ADIÇÃO: Captura a tecla "Enter" no campo de busca do topo
  var inputBusca = document.getElementById('input-busca-topo');
  if (inputBusca) {
    inputBusca.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault(); // Impede o recarregamento da página
        var dropdown = document.getElementById('search-dropdown-floating');
        if (dropdown) dropdown.style.display = 'none'; // Esconde a lista flutuante
        mostrarTodosResultadosBusca(this.value); // Filtra a vitrine
        this.blur(); // Tira o foco (esconde o teclado no celular)
      }
    });
  }
}

// Analisa os parâmetros da URL para decidir entre exibir a vitrine ou um produto específico.
function verificarRotaURL() {
  var parametros = new URLSearchParams(window.location.search);
  var idProdutoURL = parametros.get('p');
  var banner = document.getElementById('banner-home');
  
  if (idProdutoURL) {
    // --- 1. MODIFICAÇÃO: ESCONDER AO CARREGAR PRODUTO ---
    // Se entrar direto pelo link do produto, força a classe d-none
    if (banner) {
      banner.classList.add('d-none');
    }
    verProduto(idProdutoURL, false);
  } else {
    // --- 2. MODIFICAÇÃO: MOSTRAR AO CARREGAR HOME ---
    // Se for a página inicial, remove a classe d-none
    if (banner) {
      banner.classList.remove('d-none');
    }
    renderizarVitrine(bancoDeDados);
  }
}

/**=================================================================================*/


/**
 * =================================================================================
 * 3. RENDERIZAÇÃO DA VITRINE
 * =================================================================================
 */

// Renderiza a lista de produtos no container principal da loja.
function renderizarVitrine(listaProdutos) {
  var containerVitrine = document.getElementById('vitrine');
  var viewLista = document.getElementById('view-lista');
  
  // Verificação de segurança do DOM
  if (!containerVitrine) return;
  
  // Garante que a view de lista está visível
  if (viewLista) {
    viewLista.style.display = 'block';
  }

  // Filtra produtos inválidos (sem preço definido)
  var produtosValidos = listaProdutos.filter(function(p) {
    var precoVenda = v2n(p.valorVenda);
    var precoPromo = v2n(p.valorPromo);
    return precoVenda > 0 || precoPromo > 0;
  });

  // --- INJEÇÃO: ORDENAÇÃO (NEW ARRIVALS E DESTAQUES) ---
  // Regra 3.1 do Dossiê: Destaques primeiro, seguidos pelos mais recentes
  produtosValidos.sort(function(a, b) {
    // 1º Critério: Destaques ficam no topo
    if (a.isDestaque !== b.isDestaque) {
      return a.isDestaque ? -1 : 1;
    }
    // 2º Critério: Produtos mais recentes primeiro (Ordem Decrescente de dataCadastro)
    return (b.dataCadastro || 0) - (a.dataCadastro || 0);
  });

  // Se não houver produtos, exibe mensagem
  if (produtosValidos.length === 0) {
    containerVitrine.innerHTML = 
      '<div class="col-12 text-center py-5">' +
        '<i class="bi bi-search text-muted d-block mb-3" style="font-size: 3rem;"></i>' +
        '<h4 class="text-muted">Nenhum produto encontrado.</h4>' +
        '<p class="text-secondary small">Tente limpar os filtros para ver mais opções.</p>' +
      '</div>';
    return;
  }

  // Gera o HTML de cada card
  var htmlFinal = produtosValidos.map(function(p) {
    return criarCardProduto(p);
  }).join('');

  containerVitrine.innerHTML = htmlFinal;
}

// Gera o código HTML completo de um card individual de produto.
function criarCardProduto(p) {
  // 1. Cálculos de Preço
  var nVenda = v2n(p.valorVenda);
  var nPromo = v2n(p.valorPromo);
  var nPix = v2n(p.valorPix);
  
  // INJEÇÃO: Utiliza a flag do backend (Dossiê) mantendo fallback original
  var estaEmPromo = p.isPromoAtiva !== undefined ? p.isPromoAtiva : nPromo > 0;
  var precoPrincipal = estaEmPromo ? nPromo : nVenda;
  // INJEÇÃO: Flag local de estoque geral do produto
  var isEsgotado = p.estoque <= 0;
  
  // 2. Processamento da Imagem
  var fotoOriginal = (Array.isArray(p.todasFotos) && p.todasFotos.length > 0) ? p.todasFotos[0] : null;
  // A variável 'urlFoto' não é estritamente necessária aqui pois usamos a função híbrida no <img>

  // 3. Processamento das Variações (Tamanhos)
  var variacoes = Array.isArray(p.variacoes) ? p.variacoes : [];
  var tamanhosDisponiveis = [];
  
  variacoes.forEach(function(v) {
    if (v.quantidade > 0 && !tamanhosDisponiveis.includes(v.tamanho)) {
      tamanhosDisponiveis.push(v.tamanho);
    }
  });

  // Gera HTML dos badges de tamanho
  var htmlTamanhos = "";
  // INJEÇÃO: Considerar também se o produto mestre não está esgotado
  if (!isEsgotado && tamanhosDisponiveis.length > 0) {
    htmlTamanhos = tamanhosDisponiveis.slice(0, 4).map(function(t) {
      return '<span class="badge bg-white text-secondary border fw-normal me-1" style="font-size: 0.6rem;">' + t + '</span>';
    }).join('');
    
    if (tamanhosDisponiveis.length > 4) {
      htmlTamanhos += '<span class="badge bg-light text-muted border fw-normal" style="font-size: 0.6rem;">+</span>';
    }
  } else {
    // MODIFICAÇÃO: Badge vermelho com destaque conforme Dossiê
    htmlTamanhos = '<span class="badge bg-danger text-white border fw-bold px-2 py-1" style="font-size: 0.6rem; letter-spacing: 1px;">ESGOTADO</span>';
  }

  // --- BALÃO FLUTUANTE DE OFERTA ---
  var htmlOferta = estaEmPromo 
    ? `<div class="position-absolute top-0 end-0 m-2 bg-danger text-white px-2 py-1 shadow rounded-pill fw-bold d-flex align-items-center justify-content-center" 
            style="width: fit-content !important; height: auto !important; font-size: 0.65rem; z-index: 10;">
         <i class="bi bi-tag-fill me-1"></i> OFERTA
       </div>` 
    : '';

  // HTML do Preço Anterior (Riscado)
  // INJEÇÃO: Prefixo "De:"
  var htmlPrecoAntigo = estaEmPromo 
    ? '<small class="text-decoration-line-through text-muted d-block" style="font-size: 0.7rem">De: ' + n2v(nVenda) + '</small>' 
    : '';

  // INJEÇÃO: Montagem do HTML do PIX (Dossiê)
  var htmlPix = p.isPixAtivo
    ? `<div class="text-success fw-bold mt-1" style="font-size: 0.7rem;"><i class="bi bi-lightning-charge-fill"></i> ou ${n2v(nPix)} via PIX</div>` 
    : '';

  // 4. Montagem do HTML do Card
  // INJEÇÃO: Estilos condicionais (opacidade e filtro PB) removidos do 'img' para itens esgotados conforme solicitado.
  return `
    <div class="col-6 col-md-4 col-lg-3 mb-4">
      <div class="card card-produto h-100 border-0 shadow-sm" onclick="verProduto('${safeId(p.id)}')" style="cursor:pointer; overflow: hidden; ${isEsgotado ? 'opacity: 0.8;' : ''}">
        
        <div class="position-relative ratio bg-white rounded-top border-bottom" style="--bs-aspect-ratio: 125%;">
          
          <img ${obterAtributosImagem(p.id, fotoOriginal, false, p.idOtimizado)} 
            class="card-img-top object-fit-cover" 
            loading="lazy" 
            alt="${p.nome}" 
            referrerpolicy="no-referrer">
          
          ${htmlOferta}
        </div>

        <div class="card-body p-2 d-flex flex-column">
          <div class="mb-1">
            <small class="text-uppercase text-primary fw-bold" style="font-size: 0.65rem;">
              ${p.categoria || 'Geral'}
            </small>
            <h6 class="fw-bold mb-0 text-truncate text-dark" title="${p.nome}" style="font-size: 0.9rem;">
              ${p.nome || 'Produto'}
            </h6>
          </div>
          
          ${!isEsgotado ? `
          <div class="price-info mb-2">
            ${htmlPrecoAntigo}
            <span class="fw-bold text-primary" style="font-size: 1rem;">
              ${estaEmPromo ? 'Por: ' : ''}${n2v(precoPrincipal)}
            </span>
            ${htmlPix}
          </div>
          ` : ''}

          <div class="mt-auto border-top pt-2">
            <div class="d-flex flex-wrap" style="max-height: 22px; overflow: hidden;">
              ${htmlTamanhos}
            </div>
          </div>

        </div>
      </div>
    </div>`;
}

/**=================================================================================*/


/**
 * =================================================================================
 * 4. SISTEMA DE FILTROS E BUSCA
 * =================================================================================
 */

// Captura os valores marcados nos checkboxes de um determinado tipo de filtro.
function getSelecionados(tipo) {
  var inputs = document.querySelectorAll(`.filter-check[data-type="${tipo}"]:checked`);
  return Array.from(inputs).map(el => String(el.value).trim().toUpperCase());
}

// Extrai categorias, cores e tamanhos únicos dos produtos para criar os filtros.
function popularFiltrosDinamicos() {
  if (!bancoDeDados || bancoDeDados.length === 0) return;

  // 1. Filtra apenas produtos com ESTOQUE E PREÇO válidos para montar a lista inicial
  var validos = bancoDeDados.filter(function(p) {
    var temPreco = v2n(p.valorVenda) > 0 || v2n(p.valorPromo) > 0;
    var estoqueTotal = (Array.isArray(p.variacoes) ? p.variacoes : [])
       .reduce((acc, v) => acc + (Number(v.quantidade) || 0), 0);
    return temPreco && estoqueTotal > 0;
  });
  
  // 2. Extrai listas únicas
  var categorias = [...new Set(validos.map(p => p.categoria))].filter(Boolean).sort();
  var subcategorias = [...new Set(validos.map(p => p.subcategoria))].filter(Boolean).sort();
  
  var todasVariacoes = validos.flatMap(p => Array.isArray(p.variacoes) ? p.variacoes : []);
  var variacoesComEstoque = todasVariacoes.filter(v => v.quantidade > 0);
  
  var cores = [...new Set(variacoesComEstoque.map(v => v.cor))].filter(Boolean).sort();
  var tamanhos = [...new Set(variacoesComEstoque.map(v => v.tamanho))].filter(Boolean);

  // Ordenação de tamanhos
  var pesoTamanho = { 'PP':1, 'P':2, 'M':3, 'G':4, 'GG':5, 'XG':6, 'G1':7, 'G2':8, 'G3':9, 'UNICO':10 };
  tamanhos.sort((a, b) => (pesoTamanho[String(a).toUpperCase()]||99) - (pesoTamanho[String(b).toUpperCase()]||99));

  // 3. Desenha os checkboxes na tela
  renderizarCheckboxes('list-categoria', categorias, 'cat');
  renderizarCheckboxes('list-subcategoria', subcategorias, 'sub');
  renderizarCheckboxes('list-cor', cores, 'cor');
  renderizarCheckboxes('list-tamanho', tamanhos, 'tam');
}

// Cria dinamicamente os elementos HTML de checkbox para as opções de filtro.
function renderizarCheckboxes(containerId, lista, tipo) {
  var container = document.getElementById(containerId);
  if (!container) return;
  var secaoPai = container.closest('.filter-section');
  
  if (lista.length === 0) { 
    if (secaoPai) secaoPai.style.display = 'none'; 
    return; 
  }
  if (secaoPai) secaoPai.style.display = 'block';

  container.innerHTML = lista.map((item, index) => `
    <div class="checkbox-filter d-flex align-items-center mb-1">
      <input type="checkbox" id="${tipo}-${index}" value="${item}" class="filter-check me-2" data-type="${tipo}" onchange="aplicarFiltros()">
      <label for="${tipo}-${index}" class="text-truncate small" style="cursor:pointer; flex:1" title="${item}">
        ${item}
      </label>
    </div>`).join('');
}

// Valida se um produto atende simultaneamente a todos os critérios selecionados.
function validarProduto(p, fCat, fSub, fCor, fTam) {
    // A. Segurança
    if (v2n(p.valorVenda) <= 0 && v2n(p.valorPromo) <= 0) return false;
    
	/** FILTRA SOMENTE PRODUTOS COM ESTOQUE
	var estoqueTotal = (Array.isArray(p.variacoes) ? p.variacoes : [])
       .reduce((acc, v) => acc + (Number(v.quantidade) || 0), 0);
    if (estoqueTotal <= 0) return false;
	*/

    // B. Normalização
    var pCat = String(p.categoria || "").trim().toUpperCase();
    var pSub = String(p.subcategoria || "").trim().toUpperCase();
    var vars = Array.isArray(p.variacoes) ? p.variacoes : [];

    // C. Comparação
    var okCat = (fCat.length === 0 || fCat.includes(pCat));
    var okSub = (fSub.length === 0 || fSub.includes(pSub));
    
    // Para Cor e Tam, basta que UMA das variações do produto bata com o filtro E tenha estoque
    var okCor = (fCor.length === 0 || vars.some(v => 
        fCor.includes(String(v.cor||"").trim().toUpperCase()) && v.quantidade > 0
    ));

    var okTam = (fTam.length === 0 || vars.some(v => 
        fTam.includes(String(v.tamanho||"").trim().toUpperCase()) && v.quantidade > 0
    ));

    return okCat && okSub && okCor && okTam;
}

// Otimiza a interface ocultando filtros que não resultariam em nenhum produto.
function atualizarDisponibilidadeFiltros(selCat, selSub, selCor, selTam) {
  // 1. Pré-filtra a base de dados apenas uma vez para remover itens inválidos/sem estoque
  // Isso reduz o número de itens que o loop precisa verificar
  const baseReduzida = bancoDeDados.filter(p => {
    const temPreco = v2n(p.valorVenda) > 0 || v2n(p.valorPromo) > 0;
    const estoqueTotal = (p.variacoes || []).reduce((acc, v) => acc + (Number(v.quantidade) || 0), 0);
    return temPreco && estoqueTotal > 0;
  });

  const checkboxes = document.querySelectorAll('.filter-check');

  // 2. Usamos requestAnimationFrame para garantir que o navegador processe 
  // a animação do clique antes de começar o cálculo pesado.
  window.requestAnimationFrame(() => {
    checkboxes.forEach(function(chk) {
      const tipo = chk.dataset.type;
      const valor = String(chk.value).trim().toUpperCase();

      // Otimização: Se o checkbox já está marcado, ele obviamente tem produtos,
      // então pulamos o cálculo para ganhar velocidade.
      if (chk.checked) {
        const divPai = chk.closest('.checkbox-filter');
        if (divPai) {
          divPai.style.display = 'flex';
          divPai.classList.remove('d-none');
        }
        return;
      }

      // 3. Lógica de "Hipótese" (Cross-Filtering)
      const testeCat = (tipo === 'cat') ? [valor] : selCat;
      const testeSub = (tipo === 'sub') ? [valor] : selSub;
      const testeCor = (tipo === 'cor') ? [valor] : selCor;
      const testeTam = (tipo === 'tam') ? [valor] : selTam;

      // 4. Busca ultra-rápida na base reduzida
      const existeProduto = baseReduzida.some(p => validarProduto(p, testeCat, testeSub, testeCor, testeTam));

      // 5. Atualização visual limpa
      const divPai = chk.closest('.checkbox-filter');
      if (divPai) {
        if (existeProduto) {
          divPai.style.display = 'flex';
          divPai.classList.remove('d-none');
        } else {
          divPai.style.display = 'none';
          divPai.classList.add('d-none');
        }
      }
    });
  });
}

// Desmarca todos os filtros ativos e restaura a visualização original.
function limparTodosFiltros() {
  var checkboxes = document.querySelectorAll('.filter-check');
  checkboxes.forEach(function(el) {
    el.checked = false;
  });
  
  // Reseta visualização
  renderizarVitrine(bancoDeDados);
  
  // Mostra todos os filtros novamente
  document.querySelectorAll('.checkbox-filter').forEach(function(el) {
    el.style.display = 'flex';
  });
}

// =================================================================
// 🚀 INÍCIO: SISTEMA DE BUSCA FLUTUANTE (AUTOCOMPLETE)
// =================================================================

// Filtra os produtos com base em termos de texto e gera janela suspensa
function realizarBuscaTopo(termo) {
  var t = termo.trim().toUpperCase();
  var input = document.getElementById('input-busca-topo');
  
  // Encontra o container pai seguro para não ser cortado pelo overflow:hidden
  var searchContainer = input.closest('.flex-grow-1'); 
  searchContainer.style.position = 'relative';

  // Localiza ou cria a janela do dropdown
  let dropdown = document.getElementById('search-dropdown-floating');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'search-dropdown-floating';
    // 🚀 CORREÇÃO 1: Removido o max-height e overflow-y: auto para eliminar a barra de rolagem
    dropdown.style.cssText = `
      position: absolute; top: calc(100% + 5px); left: 0; width: 100%;
      background: #ffffff; z-index: 1050; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.15);
      display: none; flex-direction: column; border: 1px solid #e9ecef; overflow: hidden;
    `;
    searchContainer.appendChild(dropdown);
    
    // Clicar fora fecha o dropdown
    document.addEventListener('click', function(e) {
      if (!searchContainer.contains(e.target)) dropdown.style.display = 'none';
    });
  }

  // Se apagar o texto, fecha a janela suspensa e reseta
  if (t === "") {
    dropdown.style.display = 'none';
    resetarFiltrosTopo();
    return;
  }

  // Limpa os chips se digitar
  categoriaAtivaTopo = null;
  var containerCats = document.getElementById('container-chips-categorias');
  if (containerCats) {
     var botoes = containerCats.getElementsByTagName('button');
     for(var i=0; i < botoes.length; i++) botoes[i].className = "btn btn-sm btn-chip-cat rounded-pill px-3 text-uppercase text-nowrap flex-shrink-0 transition-all";
  }

  // Filtra produtos usando inteligência (Este filtro geral rege o botão "VER TODOS OS RESULTADOS")
  var resultados = bancoDeDados.filter(function(p) {
    if (v2n(p.valorVenda) <= 0 && v2n(p.valorPromo) <= 0) return false;
    
    // 🚀 GUILHOTINA DINÂMICA: Verifica a variável que veio do backend
    if (p.estoque <= 0) {
       let limiteDiasConfig = parseInt(AppConfig.data.TEMPO_VITRINE, 10);
       const tempoVitrine = isNaN(limiteDiasConfig) ? 90 : limiteDiasConfig;
       
       const hoje = new Date().getTime();
       const diferencaEmDias = (hoje - p.dataUltimaVenda) / (1000 * 3600 * 24);
       if (diferencaEmDias > tempoVitrine) return false;
    }
    
    var matchNome = p.nome.toUpperCase().includes(t);
    var matchId   = String(p.id).includes(t);
    var matchSku  = String(p.sku || "").toUpperCase().includes(t);
    var matchTags = String(p.tagsBusca || "").toUpperCase().includes(t);
    
    return matchNome || matchId || matchSku || matchTags;
  });

  if (resultados.length > 0) {
     // Monta sugestões de texto (usando o próprio nome do produto)
     var sugestoesHtml = resultados.slice(0, 3).map(p => {
         var nomeDestacado = p.nome.replace(new RegExp(t, 'gi'), match => `<strong class="text-dark">${match}</strong>`);
         return `<a href="javascript:void(0)" onclick="document.getElementById('search-dropdown-floating').style.display='none'; verProduto('${safeId(p.id)}');" class="text-decoration-none d-flex align-items-center p-3 border-bottom text-muted" style="transition: 0.2s;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
           <i class="bi bi-search me-3"></i>
           <span class="text-lowercase" style="font-size: 0.95rem;">${nomeDestacado}</span>
         </a>`;
     }).join('');

     // 🚀 CORREÇÃO 2 e 3: Filtra APENAS produtos COM ESTOQUE e limita a 3 itens para a janela flutuante
     var produtosComEstoque = resultados.filter(p => p.estoque > 0);
     
     var produtosHtml = produtosComEstoque.slice(0, 3).map(p => {
         let fotoOriginal = (Array.isArray(p.todasFotos) && p.todasFotos.length > 0) ? p.todasFotos[0] : null;
         let idOtimizadoUnico = (Array.isArray(p.idOtimizado) && p.idOtimizado.length > 0) ? p.idOtimizado[0] : null;
         let atributosImg = obterAtributosImagem(p.id, fotoOriginal, false, idOtimizadoUnico);

         var preco = p.isPromoAtiva ? p.valorPromo : p.valorVenda;
         
         return `<a href="javascript:void(0)" onclick="document.getElementById('search-dropdown-floating').style.display='none'; verProduto('${safeId(p.id)}');" class="text-decoration-none d-flex align-items-center p-3 border-bottom" style="transition: 0.2s;" onmouseover="this.style.background='#f8f9fa'" onmouseout="this.style.background=''">
           <div style="min-width: 60px; min-height: 60px; width: 60px; height: 60px; border-radius: 8px; overflow: hidden; background: #fff;" class="shadow-sm border me-3">
             <img ${atributosImg} style="width: 100%; height: 100%; object-fit: cover;">
           </div>
           <div class="flex-grow-1 overflow-hidden">
             <h6 class="text-dark fw-bold mb-1 text-truncate" style="font-size: 0.85rem;">${p.nome}</h6>
             <div class="d-flex align-items-center gap-2">
               <span class="fw-bold text-dark" style="font-size: 1rem;">${n2v(preco)}</span>
             </div>
           </div>
         </a>`;
     }).join('');

     dropdown.innerHTML = `
        <div class="d-flex flex-column w-100">
          <div class="bg-light px-3 py-2 border-bottom">
             <span class="text-muted fw-bold text-uppercase" style="font-size: 0.65rem; letter-spacing: 1px;">Sugestões</span>
          </div>
          <div class="d-flex flex-column m-0 p-0">${sugestoesHtml}</div>
          
          ${produtosHtml ? `
          <div class="bg-light px-3 py-2 border-bottom border-top">
             <span class="text-muted fw-bold text-uppercase" style="font-size: 0.65rem; letter-spacing: 1px;">Produtos Sugeridos</span>
          </div>
          <div class="d-flex flex-column m-0 p-0">${produtosHtml}</div>
          ` : ''}
          
          <div class="p-3 bg-white text-center">
             <button class="btn btn-dark btn-sm rounded-pill px-4 fw-bold w-100" onclick="document.getElementById('search-dropdown-floating').style.display='none'; mostrarTodosResultadosBusca('${t}');">
                VER TODOS OS ${resultados.length} RESULTADOS
             </button>
          </div>
        </div>
     `;
     dropdown.style.display = 'flex';
  } else {
     dropdown.innerHTML = `
        <div class="p-4 text-center text-muted">
           <i class="bi bi-emoji-frown fs-1 d-block mb-2 opacity-50"></i>
           <h6 class="fw-bold mb-1">Poxa, não encontramos nada</h6>
           <small style="font-size: 0.8rem;">Tente buscar por outras palavras.</small>
        </div>
     `;
     dropdown.style.display = 'flex';
  }
}

// 🚀 Chama os resultados cheios na Vitrine caso o usuário clique em "VER TODOS OS RESULTADOS"
function mostrarTodosResultadosBusca(termo) {
  voltarParaHome(false); // Retorna a tela para a Vitrine
  var t = termo.trim().toUpperCase();
  var resultados = bancoDeDados.filter(function(p) {
     if (v2n(p.valorVenda) <= 0 && v2n(p.valorPromo) <= 0) return false;
     var matchNome = p.nome.toUpperCase().includes(t);
     var matchId   = String(p.id).includes(t);
     var matchSku  = String(p.sku || "").toUpperCase().includes(t);
     var matchTags = String(p.tagsBusca || "").toUpperCase().includes(t);
     return matchNome || matchId || matchSku || matchTags;
  });
  renderizarVitrine(resultados);
  
  // Força a remoção do banner da home para focar apenas nos resultados de busca
  var banner = document.getElementById('banner-home');
  if (banner) banner.classList.add('d-none');

  // 🚀 CORREÇÃO: Rola a página suavemente para o topo para exibir os resultados filtrados
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =================================================================
// FIM: SISTEMA DE BUSCA FLUTUANTE
// =================================================================


// Aplica filtro por categoria através dos chips de navegação rápida.
function filtrarPorCategoriaTopo(categoria, btnElement) {
  // 1. RESOLUÇÃO DO BUG: Se estiver na tela de produto (PDP), força a volta para a vitrine
  const viewProduto = document.getElementById('view-produto');
  if (viewProduto && viewProduto.style.display === 'block') {
    // Chamamos voltarParaHome(false) para não criar um loop no histórico do navegador
    voltarParaHome(false); 
  }

  // 2. Limpa o campo de busca de texto para não haver conflito de filtros
  document.getElementById('input-busca-topo').value = "";
  
  // 3. Lógica de "Desmarcar" (Toggle): Se clicar no que já está ativo, reseta tudo
  if (categoriaAtivaTopo === categoria) {
      resetarFiltrosTopo();
      return;
  }

  // 4. Define a nova categoria ativa
  categoriaAtivaTopo = categoria;

  // 5. Atualização Visual dos Chips (Botões do topo)
  const container = document.getElementById('container-chips-categorias');
  if (container) {
      const todosBotoes = container.getElementsByTagName('button');
      for(let i = 0; i < todosBotoes.length; i++) {
          todosBotoes[i].className = "btn btn-sm btn-chip-cat rounded-pill px-3 text-uppercase text-nowrap flex-shrink-0 transition-all";
      }
  }
  
  // Destaca o botão clicado com a classe escura
  btnElement.className = "btn btn-sm btn-dark rounded-pill px-3 fw-bold text-uppercase text-nowrap flex-shrink-0 transition-all";

  // 6. SINCRONIZAÇÃO COM SIDEBAR (Garante que os filtros laterais reflitam o topo)
  // Desmarca todos os filtros da sidebar primeiro
  document.querySelectorAll('.filter-check').forEach(chk => chk.checked = false);
  
  // Marca o checkbox correspondente na lateral
  const inputs = document.querySelectorAll(`.filter-check[data-type="cat"]`);
  for (let i = 0; i < inputs.length; i++) {
     if (inputs[i].value.toUpperCase() === categoria.toUpperCase()) {
         inputs[i].checked = true;
         break;
     }
  }

  // 7. Executa o motor de filtros unificado
  aplicarFiltros();

  // 8. UX: Rola a página suavemente para o topo para mostrar os resultados
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Reseta especificamente as seleções feitas através da busca e chips do topo.
function resetarFiltrosTopo() {
  categoriaAtivaTopo = null;
  document.getElementById('input-busca-topo').value = "";
  
  // Reseta visual dos botões para branco
  var container = document.getElementById('container-chips-categorias');
  if (container) {
      var todosBotoes = container.getElementsByTagName('button');
      for(var i=0; i < todosBotoes.length; i++) {
          todosBotoes[i].className = "btn btn-sm btn-chip-cat rounded-pill px-3 text-uppercase text-nowrap flex-shrink-0 transition-all";
      }
  }

  // Limpa filtro real
  limparTodosFiltros();
}

// Coloca o cursor do usuário no campo de busca principal.
function focarBusca() {
    document.getElementById('input-busca-topo').focus();
}

// Executa a lógica de filtragem cruzada e atualiza a exibição da vitrine.
function aplicarFiltros() {
  // 1. Pega o que o usuário JÁ selecionou
  var selCat = getSelecionados('cat');
  var selSub = getSelecionados('sub');
  var selCor = getSelecionados('cor');
  var selTam = getSelecionados('tam');

  // 2. Filtra a GRADE DE PRODUTOS (Vitrine)
  var produtosParaVitrine = bancoDeDados.filter(function(p) {
     return validarProduto(p, selCat, selSub, selCor, selTam);
  });

  // 3. Renderiza a vitrine
  renderizarVitrine(produtosParaVitrine);

  // 4. Atualiza a visibilidade dos Checkboxes (Cross-Filtering)
  atualizarDisponibilidadeFiltros(selCat, selSub, selCor, selTam);
}
/**=================================================================================*/


/**
 * =================================================================================
 * 5. SELEÇÃO DE VARIAÇÕES E ESTOQUE
 * =================================================================================
 */

// Gera botões de seleção para os TAMANHOS disponíveis de um produto.
function gerarHTMLTamanhos(p) {
  var tamanhosUnicos = [...new Set((p.variacoes || []).map(v => v.tamanho))];
  
  // Ordenação lógica de tamanhos (PP, P, M, G, GG...)
  var pesoTamanho = { 'PP':1, 'P':2, 'M':3, 'G':4, 'GG':5, 'XG':6, 'G1':7, 'G2':8, 'G3':9, 'UNICO':10 };
  tamanhosUnicos.sort((a, b) => (pesoTamanho[String(a).toUpperCase()]||99) - (pesoTamanho[String(b).toUpperCase()]||99));

  return tamanhosUnicos.map(function(tam) {
    // Verifica se o tamanho tem estoque em pelo menos UMA cor
    var temEstoque = p.variacoes.some(v => v.tamanho === tam && v.quantidade > 0);
    var idUnico = 'tam-init-' + p.id + '-' + tam.replace(/\s+/g,'');
    
    // 🚀 REMOVIDO: O bloqueio 'disabled' foi removido para o cliente conseguir clicar e pedir o aviso
    var opacityStyle = !temEstoque ? 'opacity: 0.5;' : '';

    return `
      <input type="radio" class="btn-check" name="grupo-tam-init-${p.id}" id="${idUnico}" 
             onchange="atualizarCoresDisponiveis('${safeId(p.id)}', '${safeId(tam)}')">
      <label class="btn btn-outline-dark btn-sm px-3 py-2" for="${idUnico}" style="${opacityStyle}">
        ${tam}
      </label>`;
  }).join('');
}

// Atualiza a lista de CORES baseada no tamanho selecionado pelo usuário.
function atualizarCoresDisponiveis(idProduto, tamanhoSelecionado) {
  var p = bancoDeDados.find(x => String(x.id) === String(idProduto));
  var container = document.getElementById('container-cores-' + idProduto);
  
  // Filtra as variações que correspondem ao tamanho selecionado
  var variacoesFiltradas = p.variacoes.filter(v => v.tamanho === tamanhoSelecionado);
  
  // 🚀 VERIFICAÇÃO: Checa se ESSE tamanho específico tem alguma unidade em qualquer cor
  var estoqueTamanho = variacoesFiltradas.reduce((acc, v) => acc + (Number(v.quantidade) || 0), 0);

  // SE NÃO TEM ESTOQUE NENHUM NESTE TAMANHO: 
  // Oculta a seleção de cor e já exibe o botão de AVISE-ME
  if (estoqueTamanho <= 0) {
    container.innerHTML = '<span class="text-danger small fw-bold mt-1"><i class="bi bi-x-circle"></i> Esgotado em todas as cores.</span>';
    
    const divEstoque = document.getElementById('container-estoque-' + idProduto);
    const btn = document.getElementById('btn-whatsapp-' + idProduto);

    divEstoque.innerHTML = `
      <div class="alert alert-secondary py-2 small border-0 bg-secondary-subtle text-secondary-emphasis d-flex align-items-center">
        <i class="bi bi-exclamation-triangle-fill me-2"></i> 
        <span>Tamanho ${tamanhoSelecionado} esgotado no momento.</span>
      </div>`;

    btn.innerHTML = `<i class="bi bi-bell-fill text-warning me-2"></i> AVISE-ME QUANDO CHEGAR`;
    btn.className = "btn btn-dark w-100 py-3 mt-3 rounded shadow-sm fw-bold animate__animated animate__pulse"; 
    btn.style.opacity = "1";
    btn.style.backgroundColor = ""; 
    btn.style.borderColor = "";     
    btn.style.color = "";           
    btn.style.cursor = "pointer";
    
    // O clique já chama o modal com o tamanho que o usuário acabou de clicar!
    btn.onclick = function(e) {
      e.preventDefault();
      abrirModalAviso(idProduto, tamanhoSelecionado);
    }; 
    
    btn.style.display = 'block';
    
    // Interrompe a função aqui para não desenhar cores zeradas
    return; 
  }

  // SE TEM ESTOQUE: Segue o fluxo normal e exibe as cores
  container.innerHTML = variacoesFiltradas.map(function(v) {
    var semEstoque = v.quantidade <= 0;
    var idUnico = 'cor-' + idProduto + '-' + v.cor.replace(/\s+/g,'');
    
    var opacityStyle = semEstoque ? 'opacity: 0.5;' : '';
    
    return `
      <input type="radio" class="btn-check" name="grupo-cor-${idProduto}" id="${idUnico}" 
             onchange="selecionarVariacaoFinal('${safeId(idProduto)}', '${safeId(v.cor)}', '${safeId(tamanhoSelecionado)}', ${v.quantidade}, '${v.idCor}', '${v.idTam}')">
      <label class="btn btn-outline-secondary btn-sm px-3 py-2" for="${idUnico}" style="${opacityStyle}">
        ${v.cor}
      </label>`;
  }).join('');
  
  // Reseta a área de compra ao mudar para um tamanho COM estoque
  document.getElementById('container-estoque-' + idProduto).innerHTML = '';
  document.getElementById('btn-whatsapp-' + idProduto).style.display = 'none';
}

// Valida o estoque final da variação escolhida e libera o botão de compra (ou aviso de esgotado).
function selecionarVariacaoFinal(idProduto, cor, tam, qtdTotalEstoque, idCor, idTam) {
  const p = bancoDeDados.find(x => String(x.id) === String(idProduto));
  const divEstoque = document.getElementById('container-estoque-' + idProduto);
  const btn = document.getElementById('btn-whatsapp-' + idProduto);

  const itemNoCarrinho = carrinho.find(item => 
      item.id === idProduto && item.cor === cor && item.tamanho === tam
  );
  const qtdNoCarrinho = itemNoCarrinho ? itemNoCarrinho.qtd : 0;
  const disponivelReal = qtdTotalEstoque - qtdNoCarrinho;

  if (disponivelReal <= 0) {
    // 🚀 ALTERAÇÃO: Quando esgotado, troca a mensagem e transforma o botão em "Avise-me"
    divEstoque.innerHTML = `
      <div class="alert alert-secondary py-2 small border-0 bg-secondary-subtle text-secondary-emphasis d-flex align-items-center">
        <i class="bi bi-exclamation-triangle-fill me-2"></i> 
        <span>Variação esgotada no momento.</span>
      </div>`;

    btn.innerHTML = `<i class="bi bi-bell-fill text-warning me-2"></i> AVISE-ME QUANDO CHEGAR`;
    btn.className = "btn btn-dark w-100 py-3 mt-3 rounded shadow-sm fw-bold animate__animated animate__pulse"; 
    btn.style.opacity = "1";
    btn.style.backgroundColor = ""; 
    btn.style.borderColor = "";     
    btn.style.color = "";           
    btn.style.cursor = "pointer";
    
    // O clique agora chama a função passando o tamanho que o cliente escolheu!
    btn.onclick = function(e) {
      e.preventDefault();
      abrirModalAviso(idProduto, tam);
    }; 
    
  } else {
    divEstoque.innerHTML = `
      <div class="alert alert-success py-2 small border-0 bg-success-subtle text-success-emphasis d-flex align-items-center">
        <i class="bi bi-check-circle-fill me-2"></i> 
        <span>Disponível: <strong>${disponivelReal} unidades</strong></span>
      </div>`;

    btn.innerHTML = `<i class="bi bi-cart-plus me-2"></i> ADICIONAR AO CARRINHO`;
    btn.className = "btn w-100 py-3 mt-3 rounded shadow-sm fw-bold animate__animated animate__fadeInUp";
    btn.style.opacity = "1";
    btn.style.backgroundColor = "#FF4F95"; 
    btn.style.borderColor = "#FF4F95";     
    btn.style.color = "#FFFFFF";           
    btn.style.cursor = "pointer";
    
    btn.onclick = function(e) {
      e.preventDefault();
      const precoParaCarrinho = v2n(p.valorPromo) > 0 ? p.valorPromo : p.valorVenda;
      const fotoParaCarrinho = (p.todasFotos && p.todasFotos.length > 0) ? processarImg(p.todasFotos[0], false) : "";
      adicionarAoCarrinho(p.id, p.nome, precoParaCarrinho, cor, tam, fotoParaCarrinho, idCor, idTam);
      selecionarVariacaoFinal(idProduto, cor, tam, qtdTotalEstoque, idCor, idTam);
    };
  }

  btn.style.display = 'block';
}
/**=================================================================================*/
// Cria e abre o Modal de Aviso de Estoque extraindo TODOS os tamanhos disponíveis na loja
function abrirModalAviso(idProduto, tamanhoPreSelecionado = null) {
    // 1. TRAVA ABSOLUTA ANTI-CLIQUE DUPLO
    if (window.bloqueioModalAviso) return;
    window.bloqueioModalAviso = true;
    setTimeout(() => { window.bloqueioModalAviso = false; }, 1000); // Bloqueia novos cliques por 1s

    // 2. Encontra o produto
    var p = bancoDeDados.find(x => String(x.id) === String(idProduto));
    if (!p) return mostrarAvisoFlutuante("❌ Erro: Produto não encontrado.", "danger");

    // 3. 🚀 CORREÇÃO: Lista FIXA com toda a sua grade de tamanhos (incluindo ÚNICO por precaução para acessórios)
    var todosTamanhosBD = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'G1', 'G2', 'G3'];

    // 🚀 NOVO: Descobre quais tamanhos JÁ TÊM estoque para este produto
    var tamanhosComEstoque = [];
    (p.variacoes || []).forEach(v => {
        if (Number(v.quantidade) > 0) {
            tamanhosComEstoque.push(String(v.tamanho).toUpperCase().trim());
        }
    });

    // 🚀 NOVO: Filtra a lista padrão removendo os tamanhos que já têm estoque
    var tamanhosParaModal = todosTamanhosBD.filter(t => !tamanhosComEstoque.includes(t));

    var opcoesTamanho = tamanhosParaModal.map(t => {
        var isSelected = (tamanhoPreSelecionado && String(t).toUpperCase() === String(tamanhoPreSelecionado).toUpperCase()) ? "selected" : "";
        return `<option value="${t}" ${isSelected}>${t}</option>`;
    }).join('');

    // 4. Limpa instâncias antigas para o HTML não acumular lixo
    var modalAntigo = document.getElementById('modalAvisoEstoque');
    if (modalAntigo) modalAntigo.remove();

    // 5. CRIAÇÃO DO MODAL (Direto no Body para o CSS funcionar perfeitamente)
    var modalContainer = document.createElement('div');
    modalContainer.className = "modal fade";
    modalContainer.id = "modalAvisoEstoque";
    modalContainer.setAttribute("tabindex", "-1");
    
    modalContainer.innerHTML = `
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg rounded-4 overflow-hidden w-100">
          <div class="modal-header bg-dark text-white p-4 border-0">
            <h5 class="modal-title fw-bold mb-0 d-flex align-items-center" style="font-size: 1rem;">
              <div class="bg-white bg-opacity-25 rounded p-2 me-3 d-inline-flex"><i class="bi bi-bell-fill text-warning"></i></div>
              AVISE-ME QUANDO CHEGAR
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          
          <div class="modal-body p-4 bg-light">
            <p class="text-muted small mb-4">Deixe seus dados abaixo e avisaremos via WhatsApp assim que o produto <strong class="text-dark">${p.nome}</strong> for reposto.</p>
            
            <input type="hidden" id="aviso-sku" value="${p.sku || p.id}">
            <input type="hidden" id="aviso-nome-prod" value="${p.nome}">
            
            <div class="form-floating mb-3 shadow-sm">
              <select class="form-select border-0 fw-bold text-dark" id="aviso-tamanho">
                <option value="">Selecione...</option>
                ${opcoesTamanho}
              </select>
              <label class="text-muted fw-bold small text-uppercase">Tamanho Desejado <span class="text-danger fs-6">*</span></label>
            </div>

            <div class="form-floating mb-3 shadow-sm">
              <input type="text" class="form-control border-0 fw-bold text-dark" id="aviso-nome" placeholder="Seu nome">
              <label class="text-muted fw-bold small text-uppercase">Seu Nome <span class="text-danger fs-6">*</span></label>
            </div>

            <div class="form-floating mb-2 shadow-sm">
              <input type="tel" class="form-control border-0 fw-bold text-dark" id="aviso-whatsapp" placeholder="WhatsApp" 
                     oninput="this.value = this.value.replace(/\\D/g, '').replace(/^(\\d{2})(\\d)/g, '($1) $2').replace(/(\\d)(\\d{4})$/, '$1-$2').substring(0, 15);">
              <label class="text-muted fw-bold small text-uppercase">WhatsApp (DDD + Número) <span class="text-danger fs-6">*</span></label>
            </div>

          </div>
          <div class="modal-footer bg-white border-top p-3 d-flex justify-content-between rounded-bottom-4">
            <button type="button" class="btn btn-light fw-bold border px-4" data-bs-dismiss="modal">CANCELAR</button>
            <button type="button" class="btn btn-dark fw-bold px-4 shadow-sm rounded-pill" id="btn-salvar-aviso" onclick="enviarAvisoLead()">
              <i class="bi bi-send-fill me-2"></i> ENVIAR SOLICITAÇÃO
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalContainer);

    // 6. Instancia e abre o modal usando o padrão Bootstrap nativo
    var modalInstance = new bootstrap.Modal(modalContainer);
    modalInstance.show();
}

/**
 * =================================================================================
 * 6. GESTÃO DO CARRINHO E PEDIDOS
 * =================================================================================
 */

// Adiciona um item ao carrinho respeitando os limites de estoque.
// ATUALIZAÇÃO: Agora recebe e armazena idCor e idTam para suportar a montagem do SKU de estoque DNS.
function adicionarAoCarrinho(id, nome, preco, cor, tamanho, foto, idCor, idTam) {
    // 1. Busca o produto e a variação exata no banco de dados (planilha)
    // Lembrete: 'id' agora contém o SKU mestre do produto
    const produtoOriginal = bancoDeDados.find(p => String(p.id) === String(id));
    const variacaoOficial = produtoOriginal?.variacoes?.find(v => v.cor === cor && v.tamanho === tamanho);
    const estoqueDisponivel = variacaoOficial ? Number(variacaoOficial.quantidade) : 0;

    // 2. Verifica quanto desse item o usuário já tem no carrinho agora
    const itemNoCarrinho = carrinho.find(item => 
        item.id === id && item.cor === cor && item.tamanho === tamanho
    );
    const qtdAtualNoCarrinho = itemNoCarrinho ? itemNoCarrinho.qtd : 0;

    // 3. VALIDAÇÃO DE ESTOQUE:
    // Se a quantidade que ele quer adicionar (atual + 1) ultrapassa o estoque, paramos aqui.
    if (qtdAtualNoCarrinho >= estoqueDisponivel) {
        // O botão já deve estar desabilitado pela 'selecionarVariacaoFinal', 
        // mas esta trava garante que nada passe se o usuário for rápido demais.
        return; 
    }

    // 4. Se passou na validação, executa a adição
    if (itemNoCarrinho) {
        itemNoCarrinho.qtd += 1;
    } else {
        // v2n garante que o preço entre como número puro para não quebrar cálculos de total
        // ATUALIZAÇÃO: O objeto do carrinho agora guarda os IDs de cor e tamanho para o DNS de separação
        carrinho.push({ 
          id, 
          nome, 
          preco: v2n(preco), 
          cor, 
          tamanho, 
          foto, 
          qtd: 1,
          idCor: idCor,
          idTam: idTam 
        });
    }

    // 5. Persistência e Atualização Global da Interface
    salvarCarrinhoNoCache();
    atualizarInterfaceCarrinho();

    // 6. Sincronização de UI: Se estiver na página de produto, 
    // atualiza o botão para "Esgotado" se ele pegou a última unidade.
    // ATUALIZAÇÃO: Mantendo a conformidade com os novos parâmetros da selecionarVariacaoFinal
    if (typeof selecionarVariacaoFinal === "function") {
        selecionarVariacaoFinal(id, cor, tamanho, estoqueDisponivel, idCor, idTam);
    }

    // 7. Feedback Visual (Mobile): Abre a gaveta lateral
    if (window.innerWidth < 992) {
        abrirGavetaCarrinho();
    }
}

// Abre a interface visual do carrinho no modo mobile.
function abrirGavetaCarrinho() {
    const el = document.getElementById('offcanvasCarrinho');
    if (!el) return console.error("Elemento offcanvasCarrinho não encontrado!");

    try {
        // Forçamos a criação da instância do Bootstrap
        const instance = bootstrap.Offcanvas.getOrCreateInstance(el);
        instance.show();
    } catch (e) {
        // Caso o Bootstrap falhe, tentamos o clique simulado no botão da navbar
        const btnNavbar = document.querySelector('[data-bs-target="#offcanvasCarrinho"]');
        if (btnNavbar) btnNavbar.click();
    }
}

// Altera a quantidade de um item no carrinho com validação de estoque máximo.
function alterarQtd(index, delta) {
    const itemNoCarrinho = carrinho[index];

    // 1. Se o usuário estiver tentando ADICIONAR (+1), verificamos o estoque
    if (delta > 0) {
        // Localiza o produto e a variação exata no banco de dados oficial
        const produtoOriginal = bancoDeDados.find(p => String(p.id) === String(itemNoCarrinho.id));
        const variacaoOficial = produtoOriginal?.variacoes?.find(
            v => v.cor === itemNoCarrinho.cor && v.tamanho === itemNoCarrinho.tamanho
        );

        const estoqueDisponivel = variacaoOficial ? Number(variacaoOficial.quantidade) : 0;

        // Se a quantidade atual já é igual ou maior que o estoque, bloqueia o aumento
        if (itemNoCarrinho.qtd >= estoqueDisponivel) {
            console.warn("Ação bloqueada: Estoque insuficiente para " + itemNoCarrinho.nome);
            return; // Encerra a função sem somar nada
        }
    }

    // 2. Aplica a alteração (Soma ou Subtração)
    itemNoCarrinho.qtd += delta;

    // 3. Gerencia a remoção ou atualização
    if (itemNoCarrinho.qtd <= 0) {
        removerDoCarrinho(index);
    } else {
        salvarCarrinhoNoCache();
        atualizarInterfaceCarrinho();
    }
}

// Atualiza todos os elementos visuais, totais e badges do carrinho no site.
function atualizarInterfaceCarrinho() {
  const containerFixo = document.getElementById('itens-carrinho-fixo');
  const containerMobile = document.getElementById('itens-carrinho-mobile');
  const painelLateral = document.getElementById('carrinho-global-lateral');
  const badge = document.getElementById('cart-count');
  
  // 1. Se o carrinho estiver vazio, limpa a interface
  if (carrinho.length === 0) {
    if (painelLateral) painelLateral.style.display = 'none';
    if (badge) {
      badge.style.display = 'none';
      badge.innerText = "";
    }
    const msgVazio = '<p class="text-center text-muted small mt-5">Vazio</p>';
    if (containerFixo) containerFixo.innerHTML = msgVazio;
    if (containerMobile) containerMobile.innerHTML = msgVazio;
    if (document.getElementById('total-carrinho-fixo')) document.getElementById('total-carrinho-fixo').innerText = n2v(0);
    if (document.getElementById('total-carrinho-mobile')) document.getElementById('total-carrinho-mobile').innerText = n2v(0);
    return;
  }

  // 2. Controle de visibilidade do painel fixo (Desktop)
  if (window.innerWidth > 991) {
    if (painelLateral) painelLateral.style.display = 'block';
  } else {
    if (painelLateral) painelLateral.style.display = 'none';
  }

  let totalDinheiro = 0;
  let totalItens = 0;

  // 3. Geração do HTML com Validação de Estoque por Item
  const htmlItens = carrinho.map((item, index) => {
    totalDinheiro += (item.preco * item.qtd);
    totalItens += item.qtd;

    // --- LÓGICA DE TRAVA DE ESTOQUE ---
    // Busca o produto e a variação exata no banco de dados oficial
    const produtoOriginal = bancoDeDados.find(p => String(p.id) === String(item.id));
    const variacaoOficial = produtoOriginal?.variacoes?.find(v => v.cor === item.cor && v.tamanho === item.tamanho);
    
    const estoqueDisponivel = variacaoOficial ? Number(variacaoOficial.quantidade) : 0;
    const atingiuLimite = item.qtd >= estoqueDisponivel;
    // ---------------------------------

    const iconeMenos = item.qtd === 1 ? 'bi-trash' : 'bi-dash';

    return `
      <div class="ewc-item" style="position: relative; padding-bottom: ${atingiuLimite ? '15px' : '0'};">
        <img src="${item.foto}" alt="${item.nome}">
        <div class="ewc-item-name" style="color: #000 !important; font-weight: bold !important;">${item.nome}</div>
        <div class="ewc-item-price" style="color: #B12704 !important; font-weight: bold !important;">${n2v(item.preco * item.qtd)}</div>
        <div class="ewc-item-meta" style="color: #000 !important; font-weight: bold !important;">${item.cor} | ${item.tamanho}</div>
        
        <div class="a-stepper-container">
            <button class="a-stepper-btn" onclick="alterarQtd(${index}, -1)">
                <i class="bi ${iconeMenos}"></i>
            </button>
            <div class="a-stepper-value">${item.qtd}</div>
            
            <button class="a-stepper-btn" 
                    onclick="alterarQtd(${index}, 1)"
                    ${atingiuLimite ? 'disabled style="opacity: 0.2; cursor: not-allowed;"' : ''}>
                <i class="bi bi-plus"></i>
            </button>
        </div>
        
        ${atingiuLimite ? `<div class="text-danger fw-bold" style="font-size: 8px; text-align: center; width: 100%; margin-top: 2px;">LIMITE EM ESTOQUE</div>` : ''}
      </div>`;
  }).join('');

  if (containerFixo) containerFixo.innerHTML = htmlItens;
  if (containerMobile) containerMobile.innerHTML = htmlItens;

  // 4. Atualização dos Totais
  const valorFormatado = n2v(totalDinheiro);
  if (document.getElementById('total-carrinho-fixo')) document.getElementById('total-carrinho-fixo').innerText = valorFormatado;
  if (document.getElementById('total-carrinho-mobile')) document.getElementById('total-carrinho-mobile').innerText = valorFormatado;

  // 5. Atualização do Badge
  if (badge) {
    badge.innerText = totalItens;
    badge.style.display = 'flex';
  }

  // No final da função atualizarInterfaceCarrinho, adicione:
  if (document.getElementById('view-produto').style.display === 'block') {
      // Isso força a página de produto a se atualizar caso o usuário mexa no carrinho lateral
      // (Opcional, mas deixa o sistema perfeito)
  }
}

// Remove permanentemente um item da lista do carrinho.
function removerDoCarrinho(index) {
    carrinho.splice(index, 1);
    salvarCarrinhoNoCache();
    atualizarInterfaceCarrinho();
}

// Formata os itens do carrinho e redireciona o usuário para o WhatsApp da loja.
function enviarPedidoWhatsApp() {
    if (carrinho.length === 0) {
        alert("Seu carrinho está vazio!");
        return;
    }

    let mensagem = "*NOVO PEDIDO - VITRINE VIRTUAL*\n";
    mensagem += "------------------------------------------\n\n";
    
    let totalGeral = 0;

    carrinho.forEach((item, i) => {
        // CORREÇÃO: Calcula o subtotal (Preço x Quantidade)
        const subtotalItem = item.preco * item.qtd;
        totalGeral += subtotalItem;

        // ATUALIZAÇÃO DNS: Montagem do SKU de Estoque composto {SKU}{TAM2}{COR3}
        // O item.id já é o SKU base, item.idTam tem 2 dígitos e item.idCor tem 3 dígitos.
        const skuEstoque = String(item.id) + String(item.idTam) + String(item.idCor);

        mensagem += `*${i + 1}. ${item.nome}*\n`;
        // Inserção do SKU Composto para facilitar a separação no estoque físico
        mensagem += `🔹 SKU: ${skuEstoque}\n`; 
        mensagem += `🔹 Cor: ${item.cor} | Tam: ${item.tamanho}\n`;
        
        // Se houver mais de 1 unidade, mostra a quantidade e o subtotal
        if (item.qtd > 1) {
            mensagem += `🔢 Qtd: ${item.qtd} x ${n2v(item.preco)}\n`;
            mensagem += `💰 Subtotal: ${n2v(subtotalItem)}\n\n`;
        } else {
            mensagem += `💰 Preço: ${n2v(item.preco)}\n\n`;
        }
    });

    mensagem += "------------------------------------------\n";
    mensagem += `*TOTAL ESTIMADO: ${n2v(totalGeral)}*\n\n`;
    mensagem += "Gostaria de confirmar a disponibilidade destes items.";

    // CORREÇÃO: Usa o telefone da planilha (window.SEU_TELEFONE_LOJA) 
    // ou o fixo caso a planilha ainda esteja carregando
    const telefoneFinal = window.SEU_TELEFONE_LOJA || SEU_TELEFONE;
    
    const url = 'https://api.whatsapp.com/send?phone=' + telefoneFinal + '&text=' + encodeURIComponent(mensagem);
    
    window.open(url, '_blank');

    // LIMPEZA PÓS-PEDIDO
    carrinho = []; 
    salvarCarrinhoNoCache(); 
    atualizarInterfaceCarrinho();
}

// Persiste os dados atuais do carrinho no LocalStorage do navegador.
function salvarCarrinhoNoCache() {
  localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(carrinho));
}

// Recupera os itens do carrinho salvos em sessões anteriores.
function carregarCarrinhoDoCache() {
  const cache = localStorage.getItem(CHAVE_CARRINHO);
  if (cache) {
    try {
      carrinho = JSON.parse(cache);
      atualizarInterfaceCarrinho(); // Atualiza a tela com o que foi carregado
    } catch (e) {
      console.error("Erro ao carregar carrinho:", e);
      carrinho = [];
    }
  }
}

// Decide entre abrir o offcanvas ou focar no carrinho fixo dependendo da tela.
function gerenciarCliqueCarrinho() {
  // 992px é o padrão do Bootstrap para Desktop (lg)
  if (window.innerWidth < 992) {
    const el = document.getElementById('offcanvasCarrinho');
    if (el && typeof bootstrap !== 'undefined') {
      const instancia = bootstrap.Offcanvas.getOrCreateInstance(el);
      instancia.show();
    }
  } else {
    // No Desktop, não fazemos nada. 
    // O carrinho lateral já está visível e fixo.
    console.log("Clique ignorado: Carrinho fixo já visível no Desktop.");
  }
}
/**=================================================================================*/


/**
 * =================================================================================
 * 7. SISTEMA DE ZOOM E INTERAÇÃO
 * =================================================================================
 */


// VARIÁVEIS DE ESTADO
let zoomAtual = 1; // Variável que controla o nível de aproximação da imagem.
let isDragging = false; // Estado booleano para identificar se o usuário está arrastando a imagem.
let startX = 0, startY = 0; // Posições iniciais de clique para cálculos de arrasto.
let translateX = 0, translateY = 0; // Coordenadas de deslocamento da imagem no eixo X e Y.

// Monta e exibe o modal de tela cheia com funções de zoom.
function abrirZoomModal(idProduto, indiceInicial) {
   // 1. Verificação de Segurança
   var container = document.getElementById('modal-container');
   if (!container) {
     console.error("ERRO: <div id='modal-container'> não encontrada.");
     return;
   }
   
   if (typeof bootstrap === 'undefined') return;

   // 2. Busca o produto
   var p = bancoDeDados.find(x => String(x.id) === String(idProduto));
   if (!p) return;

   // 3. Processa imagens para o backup do carrossel
   var fotos = (Array.isArray(p.todasFotos) && p.todasFotos.length > 0) ? p.todasFotos : [];
   var imagensZoom = fotos.map(function(url) { return processarImg(url, true); });

   // 4. Reseta variáveis de estado do Zoom
   zoomAtual = 1;
   translateX = 0; 
   translateY = 0;
   isDragging = false;

   // 5. Monta o HTML do Modal de Zoom
   var htmlModal = `
     <div class="modal fade" id="modalZoom" tabindex="-1" aria-hidden="true">
       <div class="modal-dialog modal-fullscreen">
         <div class="modal-content" style="background-color: #000;">
           
           <div id="carouselZoom" class="carousel slide w-100 h-100" data-bs-interval="false">
              <div class="carousel-inner h-100">
               ${fotos.map(function(urlDrive, i) {
                  var activeClass = (i === indiceInicial) ? 'active' : '';
                  
                  // CORREÇÃO: Captura o ID otimizado específico para esta posição da galeria
                  // Se p.idOtimizado for um array, pegamos o índice [i]. Caso contrário, tratamos como nulo.
                  var idOtimizadoEspecifico = (Array.isArray(p.idOtimizado) && p.idOtimizado[i]) ? p.idOtimizado[i] : null;

                  return `
                    <div class="carousel-item ${activeClass} h-100">
                      <div class="img-zoom-container w-100 h-100 d-flex align-items-center justify-content-center" style="padding-bottom: 80px;">
                        <img ${obterAtributosImagem(p.id, urlDrive, true, idOtimizadoEspecifico)} 
                            class="d-block" 
                            id="img-zoom-${i}"
                            style="max-height: 82vh; max-width: 100vw; object-fit: contain;"
                            onmousedown="iniciarArrasto(event)"
                            onmousemove="arrastar(event)"
                            onmouseup="pararArrasto()"
                            onmouseleave="pararArrasto()"
                            onwheel="controlarZoomScroll(event)"
                            referrerpolicy="no-referrer">
                      </div>
                    </div>`;
                }).join('')}
             </div>
             
             ${imagensZoom.length > 1 ? `
               <button class="carousel-control-prev" type="button" data-bs-target="#carouselZoom" data-bs-slide="prev" onclick="resetarZoomAoMudar()" style="z-index: 1090;">
                 <span class="carousel-control-prev-icon p-3 bg-dark rounded-circle border border-secondary" aria-hidden="true"></span>
               </button>
               <button class="carousel-control-next" type="button" data-bs-target="#carouselZoom" data-bs-slide="next" onclick="resetarZoomAoMudar()" style="z-index: 1090;">
                 <span class="carousel-control-next-icon p-3 bg-dark rounded-circle border border-secondary" aria-hidden="true"></span>
               </button>
             ` : ''}

             <button type="button" class="btn-close-custom" data-bs-dismiss="modal" aria-label="Close" style="z-index: 1100;">
               <i class="bi bi-x-lg"></i>
             </button>

             <div class="zoom-toolbar" style="z-index: 1100;">
                <button onclick="aplicarZoom(-0.5)"><i class="bi bi-dash-lg"></i></button>
                <button onclick="aplicarZoom(0)"><i class="bi bi-aspect-ratio"></i></button>
                <button onclick="aplicarZoom(0.5)"><i class="bi bi-plus-lg"></i></button>
             </div>
           </div>
         </div>
       </div>
     </div>
   `;
   
   container.innerHTML = htmlModal;
   
   try {
     var elModal = document.getElementById('modalZoom');
     document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
     var modalInstance = new bootstrap.Modal(elModal);
     modalInstance.show();
   } catch (e) {
     console.error("Erro ao abrir modal de zoom:", e);
   }
}

// Aplica o fator de escala na imagem conforme interação do usuário.(BOTÕES E SCROLL)
function aplicarZoom(fator) {
  // Se fator for 0, reseta tudo (centraliza)
  if (fator === 0) {
    zoomAtual = 1;
    translateX = 0;
    translateY = 0;
  } else {
    // Arredonda para evitar dízimas infinitas no JS (ex: 1.300000002)
    zoomAtual = Math.round((zoomAtual + fator) * 100) / 100;
  }

  // Limites do Zoom
  if (zoomAtual < 1) zoomAtual = 1;
  if (zoomAtual > 5) zoomAtual = 5; // Limite máximo de 5x

  // Se voltou para 1x, força a centralização novamente
  if (zoomAtual === 1) {
    translateX = 0;
    translateY = 0;
  }

  atualizarTransformacao();
}

// Gerencia o zoom através do scroll do mouse.
function controlarZoomScroll(event) {
    // Impede que a página de trás role
    event.preventDefault();

    // Detecta a direção: para cima (negativo) = zoom in, para baixo (positivo) = zoom out
    const direcao = Math.sign(event.deltaY) * -1;

    // Velocidade suave (0.2x por movimento)
    const velocidade = 0.2;

    aplicarZoom(direcao * velocidade);
}

// Reseta as coordenadas e escala ao mudar de imagem no carrossel.
function resetarZoomAoMudar() {
  // Chamado pelas setas do carrossel
  zoomAtual = 1;
  translateX = 0;
  translateY = 0;
  
  // Reseta visualmente todas as imagens
  var todasImagens = document.querySelectorAll('#carouselZoom img');
  todasImagens.forEach(img => {
      img.style.transform = 'translate(0px, 0px) scale(1)';
      img.classList.remove('grabbing');
  });
}

// Captura a posição X do cursor ou toque. --- FUNÇÕES DE ARRASTO (DRAG & DROP) ---
function getClientX(event) {
    return event.touches ? event.touches[0].clientX : event.clientX;
}

// Captura a posição Y do cursor ou toque. --- FUNÇÕES DE ARRASTO (DRAG & DROP) ---
function getClientY(event) {
    return event.touches ? event.touches[0].clientY : event.clientY;
}

// Inicia a captura de movimento para arrastar imagens ampliadas.
function iniciarArrasto(event) {
    if (zoomAtual <= 1) return;
    event.preventDefault(); 
    isDragging = true;
    startX = getClientX(event) - translateX;
    startY = getClientY(event) - translateY;
    event.target.classList.add('grabbing');
}

// Calcula o deslocamento da imagem durante o movimento do cursor.
function arrastar(event) {
    if (!isDragging) return;
    event.preventDefault();
    translateX = getClientX(event) - startX;
    translateY = getClientY(event) - startY;
    atualizarTransformacao();
}

// Finaliza o estado de arrasto da imagem.
function pararArrasto() {
    isDragging = false;
    var imgAtiva = document.querySelector('#carouselZoom .carousel-item.active img');
    if(imgAtiva) imgAtiva.classList.remove('grabbing');
}

// Aplica as propriedades CSS de transformação para refletir zoom e arrasto.
function atualizarTransformacao() {
    var imgAtiva = document.querySelector('#carouselZoom .carousel-item.active img');
    if (imgAtiva) {
        imgAtiva.style.transform = `translate(${translateX}px, ${translateY}px) scale(${zoomAtual})`;
    }
}
/**=================================================================================*/


/**
 * =================================================================================
 * 8. IDENTIDADE VISUAL E CONFIGURAÇÃO (APPCONFIG)
 * =================================================================================
 */

// Objeto que gerencia dados dinâmicos da planilha como logos, banners e rodapé.
const AppConfig = {
  data: {},

  // 1. Busca os dados do servidor (DAO)
init: function() {
    // Carrega do Cache Local instantaneamente
    const configCache = localStorage.getItem('cache_config_vitrine_v1');
    if (configCache) {
      try {
        this.data = JSON.parse(configCache);
        this.applyToDOM();
      } catch (e) {
        console.error("Erro ao ler cache de configuração:", e);
      }
    }

    // Busca no Google em background para atualizar se algo mudou
    fetch(API_URL + "?action=getConfigDAO")
      .then(response => response.json())
      .then((res) => {
        // Só atualiza se houver mudança real
        if (JSON.stringify(this.data) !== JSON.stringify(res)) {
            this.data = res; 
            localStorage.setItem('cache_config_vitrine_v1', JSON.stringify(res));
            this.applyToDOM();
        }
      })
      .catch(err => console.warn("Configurações não encontradas ou erro no DAO.", err));
  },

  // 2. Injeta os dados e aplica as regras de design
  applyToDOM: function() {
    const c = this.data;
    if (!c || c.erro) {
      console.warn("Configurações não encontradas ou erro no DAO.");
      return;
    }

    // --- 1. LOGOS DINÂMICAS ---
    const imgLogo = document.getElementById('logo-loja');
    if (imgLogo && c.LINK_LOGO) imgLogo.src = c.LINK_LOGO;

    // --- 2. BANNER RESPONSIVO (REGRA 700PX) ---
    // --- BANNER RESPONSIVO (700PX) ---
    const banner = document.getElementById('banner-home');
    if (banner && c.LINK_BANNER) {
        let urlFinal = c.LINK_BANNER.trim();
        let gradienteFinal; 

        // Sincronia absoluta com o CSS
        const isMobileUI = window.matchMedia("(max-width: 800px)").matches;

        if (isMobileUI) {
            // MODO MOBILE: Imagem _mobile e degradê que nasce no rodapé (to top)
            urlFinal = urlFinal.replace(/\.png$/i, '_mobile.png');
            gradienteFinal = `linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.1) 35%, rgba(0,0,0,0) 90%)`;
        } else {
            // MODO DESKTOP: Seu gradiente central de 4 pontos (to bottom)
            gradienteFinal = `linear-gradient(to bottom, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.5) 30%, rgba(0,0,0,0.5) 65%, rgba(0,0,0,0.1) 100%)`;
        }

        banner.style.backgroundImage = `${gradienteFinal}, url('${urlFinal}')`;
    }

      // --- 3. RODAPÉ: TEXTOS E ESTILO ---
      const sobreEl = document.getElementById('footer-sobre');
      if (sobreEl) {
        sobreEl.innerText = c.SOBRE_NOS || "";
        sobreEl.style.textAlign = "justify";
        sobreEl.style.color = "#000";
      }

      const emailEl = document.getElementById('footer-email');
      if (emailEl) {
        emailEl.innerText = c.EMAIL || "";
        emailEl.style.color = "#000";
      }

      // Instagram e WhatsApp seguem o padrão de cores pretas no rodapé cinza
      const instaBtn = document.getElementById('footer-insta');
      if (instaBtn) {
        instaBtn.style.display = c.LINK_INSTAGRAM ? 'inline-flex' : 'none';
        if (c.LINK_INSTAGRAM) {
          instaBtn.href = c.LINK_INSTAGRAM;
          instaBtn.style.color = "#000";
        }
      }

      // --- 4. WHATSAPP (CORREÇÃO DO LINK E FORMATAÇÃO) ---
      if (c.WHATSAPP) {
        let foneRaw = String(c.WHATSAPP).replace(/\D/g, ''); 
        window.SEU_TELEFONE_LOJA = foneRaw.startsWith('55') ? foneRaw : '55' + foneRaw;
        
        let foneExibicao = foneRaw.startsWith('55') ? foneRaw.substring(2) : foneRaw;
        let foneFormatado = foneExibicao;

        if (foneExibicao.length === 11) {
          foneFormatado = `(${foneExibicao.substring(0,2)}) ${foneExibicao.substring(2,3)} ${foneExibicao.substring(3,7)}-${foneExibicao.substring(7)}`;
        } else if (foneExibicao.length === 10) {
          foneFormatado = `(${foneExibicao.substring(0,2)}) ${foneExibicao.substring(2,6)}-${foneExibicao.substring(6)}`;
        }

        const whatsappEl = document.getElementById('footer-whatsapp');
        if (whatsappEl) {
          whatsappEl.innerHTML = `
            <a href="https://wa.me/${window.SEU_TELEFONE_LOJA}" target="_blank" 
              class="text-decoration-none d-flex align-items-center gap-2 justify-content-center justify-content-md-end" 
              style="color: #000;">
              <i class="bi bi-whatsapp"></i> <span>${foneFormatado}</span>
            </a>`;
        }
      }
  }
};
/**=================================================================================*/


/**
 * =================================================================================
 * 9. LISTENERS E EVENTOS GLOBAIS
 * =================================================================================
 */

// Aplica logos, banners responsivos e textos de contato ao DOM.
window.addEventListener('resize', () => AppConfig.applyToDOM());

// Monitora o estado do histórico do navegador para permitir o uso do botão "Voltar".
window.onpopstate = function(event) {
  if (event.state && event.state.view === 'pdp') {
    // Se o estado for um produto, abre a tela do produto sem gerar novo histórico
    verProduto(event.state.id, false); 
  } else {
    // Caso contrário (ou se for a home), volta para a vitrine
    voltarParaHome(false); 
  }
};

// Busca as configurações globais da loja no servidor.
window.onload = function() {
  carregarDadosIniciais();     // Seus produtos
  carregarCarrinhoDoCache();   // Seu carrinho
  AppConfig.init();            // Suas configurações da planilha
};

/**=================================================================================*/

/**
 * =================================================================================
 * 10. NAVEGAÇÃO E GERENCIAMENTO DE TELAS
 * =================================================================================
 */

// Gerencia a transição para a visualização de detalhes de um produto, ajustando histórico, visibilidade de banners e colunas de layout.
function verProduto(id, adicionarAoHistorico) {
  if (adicionarAoHistorico === undefined) {
    adicionarAoHistorico = true;
  }

  // 1. Busca o produto pelo ID
  var p = bancoDeDados.find(x => String(x.id) === String(id));
  
  if (!p) {
    console.warn("Produto não encontrado no banco local:", id);
    return;
  }

  // 2. Gerencia o histórico do navegador (botão voltar)
  if (adicionarAoHistorico) {
    window.history.pushState({ view: 'pdp', id: id }, "", "?p=" + id);
  }

  // --- 3. MODIFICAÇÃO CRUCIAL: ESCONDER O BANNER ---
  // Usamos classList.add('d-none') para ativar o !important do seu CSS
  var banner = document.getElementById('banner-home');
  if (banner) {
    banner.classList.add('d-none');
  }

  // 4. ALTERAÇÃO DE VISIBILIDADE DAS TELAS
  document.getElementById('view-lista').style.display = 'none';
  
  // 5. Esconde a barra lateral de filtros (Sidebar)
  var sidebar = document.querySelector('.sidebar-filtros');
  if (sidebar && sidebar.parentElement) {
    sidebar.parentElement.style.display = 'none';
  }
  
  // 6. Ajusta a coluna principal para ocupar a tela inteira (Full Width)
  var colunaPrincipal = document.getElementById('view-lista').parentElement;
  if (colunaPrincipal) {
    colunaPrincipal.classList.remove('col-lg-9'); 
    colunaPrincipal.classList.add('col-12'); 
  }

  // 7. Mostra a tela do produto e limpa o container
  var viewProduto = document.getElementById('view-produto');
  viewProduto.style.display = 'block';
  viewProduto.innerHTML = `
    <div class="container" style="max-width: 960px; margin: 0 auto;">
      <div id="pdp-wrapper" class="row g-4 mt-2"></div>
    </div>
  `;
  
// 8. Renderiza o conteúdo PRIMEIRO
  renderizarDetalhesProduto(p);

  // 🚀 9. FORÇA A PÁGINA PARA O TOPO (A CORREÇÃO ESTÁ AQUI)
  // O atraso de 50ms garante que o HTML do produto já existe, impedindo que o navegador se perca na altura.
  setTimeout(function() {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    
    // Trava de segurança extra para celulares (iPhone/Safari) que tentam ignorar o scrollTo
    document.body.scrollTop = 0;
    document.documentElement.scrollTop = 0;
  }, 50);
}

// Restaura a interface para o estado inicial da vitrine, reativando banners, barras laterais e re-renderizando o grid de produtos.
function voltarParaHome(adicionarAoHistorico) {
  if (adicionarAoHistorico === undefined) {
    adicionarAoHistorico = true;
  }
  
  if (adicionarAoHistorico) {
    window.history.pushState({ view: 'home' }, "", "?page=home");
  }
  
  // --- 1. MODIFICAÇÃO CRUCIAL: MOSTRAR O BANNER ---
  // Removemos a classe 'd-none' para que o banner volte a aparecer na Home
  var banner = document.getElementById('banner-home');
  if (banner) {
    banner.classList.remove('d-none');
  }
  
  // 2. Esconde Produto, Mostra Lista
  document.getElementById('view-produto').style.display = 'none';
  document.getElementById('view-lista').style.display = 'block';
  
  // 3. Restaura Sidebar de Filtros
  var sidebar = document.querySelector('.sidebar-filtros');
  if (sidebar && sidebar.parentElement) {
    sidebar.parentElement.style.display = 'block';
  }

  // 4. Restaura o Layout do Grid (de 100% para largura com sidebar)
  var colunaPrincipal = document.getElementById('view-lista').parentElement;
  if (colunaPrincipal) {
    colunaPrincipal.classList.remove('col-12'); 
    colunaPrincipal.classList.add('col-lg-9'); 
  }

  // 5. Re-renderiza a vitrine para garantir o layout correto
  renderizarVitrine(bancoDeDados);
}
/**=================================================================================*/


/**
 * =================================================================================
 * 11. RENDERIZAÇÃO DE INTERFACE (PDP)
 * =================================================================================
 */

function renderizarDetalhesProduto(p) {
  var divConteudo = document.getElementById('pdp-wrapper');
  
  // Dados de Preço
  var vVenda = v2n(p.valorVenda);
  var vPromo = v2n(p.valorPromo);
  var vPix = v2n(p.valorPix);
  
  // --- INJEÇÃO: REGRAS DO DOSSIÊ (Promoção, Pix e Estoque) ---
  var estaEmPromo = p.isPromoAtiva !== undefined ? p.isPromoAtiva : vPromo > 0;
  var temPix = p.isPixAtivo !== undefined ? p.isPixAtivo : vPix > 0;
  var precoFinal = estaEmPromo ? vPromo : vVenda;
  var isEsgotado = p.estoque <= 0;

  // Processamento de Fotos
  var fotos = (Array.isArray(p.todasFotos) && p.todasFotos.length > 0) ? p.todasFotos : [];
  
  // Passamos 'true' para forçar a imagem ORIGINAL (Alta qualidade) no processamento de backup
  var fotosProcessadas = fotos.length > 0 
    ? fotos.map(function(url) { return processarImg(url, true); }) 
    : ['https://via.placeholder.com/600x600?text=Sem+Foto'];

  // --- INJEÇÃO: LÓGICA CONDICIONAL DE ESTOQUE E CORES DOS BOTÕES ---
  var htmlOpcoesCompra = "";
  if (isEsgotado) {
    // 1. PRODUTO ESGOTADO: Oculta tamanhos/cores e mostra o formulário de Leads
    htmlOpcoesCompra = `
      <div class="alert alert-danger text-center fw-bold rounded shadow-sm mb-4">
        <i class="bi bi-x-circle me-2"></i> PRODUTO ESGOTADO
      </div>
      <button onclick="abrirModalAviso('${safeId(p.sku || p.id)}', '${safeId(p.nome)}')" class="btn btn-dark w-100 py-3 fw-bold rounded shadow-sm animate__animated animate__pulse">
        <i class="bi bi-bell-fill text-warning me-2"></i> AVISE-ME QUANDO CHEGAR
      </button>
      <p class="text-muted small text-center mt-2">Te mandaremos um WhatsApp assim que repormos o estoque!</p>
    `;
  } else {
    // 2. PRODUTO DISPONÍVEL: Exibe o fluxo normal
    // 🚀 ALTERAÇÃO: O botão carrinho agora usa apenas classes btn-dark para conversão neutra e elegante.
    htmlOpcoesCompra = `
         <div class="mb-3">
           <label class="small fw-bold d-block mb-2 text-muted">1. ESCOLHA O TAMANHO:</label>
           <div class="d-flex flex-wrap gap-2">
             ${gerarHTMLTamanhos(p)}
           </div>
         </div>
         
         <div>
           <label class="small fw-bold d-block mb-2 text-muted">2. ESCOLHA A COR:</label>
           <div id="container-cores-${p.id}" class="d-flex flex-wrap gap-2">
             <span class="text-muted small fst-italic">Selecione um tamanho acima para ver as cores...</span>
           </div>
         </div>
         
         <div id="container-estoque-${p.id}" class="mt-3"></div>
         
          <a id="btn-whatsapp-${p.id}" href="javascript:void(0)" 
            class="btn w-100 py-3 mt-3 rounded shadow-sm fw-bold animate__animated animate__fadeInUp" 
            style="display:none; transition: all 0.3s; background-color: #FF4F95; border-color: #FF4F95; color: #FFFFFF;">
            <i class="bi bi-cart-plus me-2"></i> ADICIONAR AO CARRINHO
          </a>
			<!-- 🚀 AJUSTE VISUAL: O link agora tem pistas claras de interatividade -->
          <div class="text-center mt-4">
            <a href="javascript:void(0)" onclick="abrirModalAviso('${safeId(p.id)}')" 
               class="text-muted small text-decoration-underline" 
               style="transition: 0.3s; cursor: pointer; display: inline-block;" 
               onmouseover="this.style.color='#FF4F95'; this.style.transform='scale(1.02)';" 
               onmouseout="this.style.color=''; this.style.transform='scale(1)';"
               title="Clique para ser avisado sobre tamanhos">
              <i class="bi bi-bell-fill me-1"></i> Gostou, mas não tem seu tamanho? <strong>Avise-me quando disponível.</strong>
            </a>
          </div>
    `;
  }

  // 🚀 ALTERAÇÃO DE LAYOUT (Geração do HTML com Ordem Invertida)
  divConteudo.innerHTML = `
    <div class="col-md-5">
      <div id="pdp-carousel" class="carousel slide border rounded bg-white shadow-sm">
        
        <div class="carousel-inner">
          ${fotos.map(function(urlDrive, i) {
            var activeClass = (i === 0) ? 'active' : '';
            var idOtimizadoUnico = (p.idOtimizado && p.idOtimizado[i]) ? p.idOtimizado[i] : null;

            return `
              <div class="carousel-item ${activeClass}">
                <div class="ratio" style="--bs-aspect-ratio: 125%; background-color: #fff;">
                  <img ${obterAtributosImagem(p.id, urlDrive, false, idOtimizadoUnico)} 
                      class="object-fit-cover" 
                      style="width: 100%; height: 100%; cursor: zoom-in;" 
                      onclick="abrirZoomModal('${safeId(p.id)}', ${i})"
                      referrerpolicy="no-referrer">
                </div>
              </div>`;
          }).join('')}
        </div>
        
        ${fotosProcessadas.length > 1 ? `
          <button class="carousel-control-prev" type="button" data-bs-target="#pdp-carousel" data-bs-slide="prev">
            <span class="carousel-control-prev-icon bg-secondary rounded-circle p-2" aria-hidden="true" style="width:2.5rem;height:2.5rem;background-size:50%"></span>
          </button>
          <button class="carousel-control-next" type="button" data-bs-target="#pdp-carousel" data-bs-slide="next">
            <span class="carousel-control-next-icon bg-secondary rounded-circle p-2" aria-hidden="true" style="width:2.5rem;height:2.5rem;background-size:50%"></span>
          </button>
        ` : ''}
      </div>
      <div class="text-center mt-2 text-muted small">
        <i class="bi bi-zoom-in"></i> Toque na imagem para ampliar
      </div>
    </div>

    <div class="col-md-7 ps-md-4">
      <!-- 🚀 CORREÇÃO: Aplicado a cor #FF4F95 no botão de Voltar -->
      <button onclick="voltarParaHome()" class="btn btn-link text-decoration-none p-0 mb-2 small fw-bold" style="color: #FF4F95 !important;">
       <i class="bi bi-arrow-left"></i> Voltar para a loja
      </button>
      
      <h3 class="fw-bold text-dark mb-1">${p.nome}</h3>
      <p class="text-muted small mb-3">Ref: ${p.id} | Categoria: ${p.categoria}</p>
      
      ${!isEsgotado ? `
      <div class="p-3 bg-light rounded border mb-4">
        ${estaEmPromo ? '<small class="text-decoration-line-through text-muted">De: ' + n2v(vVenda) + '</small>' : ''}
        
        <div class="d-flex align-items-center gap-2">
          <h2 class="fw-bold mb-0 text-primary">${n2v(precoFinal)}</h2>
          ${estaEmPromo ? '<span class="badge bg-danger">OFERTA</span>' : ''}
        </div>
        
        ${temPix ? '<div class="text-success small fw-bold mt-1"><i class="bi bi-qr-code"></i> ou ' + n2v(vPix) + ' via PIX</div>' : ''}
      </div>
      ` : ''}

      <!-- 🚀 ALTERAÇÃO 1: Bloco de Compra e Carrinho vem ANTES da descrição -->
      <div class="card p-3 border-0 bg-light shadow-sm mb-4">
         ${htmlOpcoesCompra}
      </div>

      <!-- 🚀 ALTERAÇÃO 2: Descrição movida para DEPOIS do Bloco de Compra -->
      <div class="mb-4">
        <h6 class="fw-bold small text-uppercase text-muted border-bottom pb-1">Descrição</h6>
        <p class="text-secondary small mt-2" style="white-space: pre-line; line-height: 1.5;">
          ${p.descricao || 'Este produto não possui descrição detalhada.'}
        </p>
      </div>

    </div>`;
    
  // Inicializa o carrossel do Bootstrap
  var carrosselEl = document.getElementById('pdp-carousel');
  if (carrosselEl) {
    new bootstrap.Carousel(carrosselEl);
  }
}

// Processa o banco de dados para criar e exibir os botões (chips) de categorias únicas no topo da aplicação.
function renderizarChipsCategorias() {
  if (bancoDeDados.length === 0) return;

  var validos = bancoDeDados.filter(p => (v2n(p.valorVenda) > 0 || v2n(p.valorPromo) > 0));
  var categorias = [...new Set(validos.map(p => p.categoria))].filter(Boolean).sort();

  var container = document.getElementById('container-chips-categorias');
  
  if (!container) return; 

  var htmlCats = categorias.map(cat => `
      <button onclick="filtrarPorCategoriaTopo('${cat}', this)" 
              class="btn btn-sm btn-chip-cat rounded-pill px-3 text-uppercase text-nowrap flex-shrink-0 transition-all"
              data-cat="${cat}">
        ${cat}
      </button>
  `).join('');

  container.innerHTML = htmlCats;
}

// =================================================================================
// ENVIO DOS DADOS DO MODAL DE AVISO (LEADS)
// =================================================================================

// Coleta os dados do Modal e envia para o Back-end (Planilha)
function enviarAvisoLead() {
    // Captura os elementos HTML inteiros (para podermos mudar a borda deles)
    const inputTamanho = document.getElementById('aviso-tamanho');
    const inputNome = document.getElementById('aviso-nome');
    const inputWhatsapp = document.getElementById('aviso-whatsapp');

    const sku = document.getElementById('aviso-sku').value;
    const nomeProd = document.getElementById('aviso-nome-prod').value;
    
    // Pega os valores digitados
    const tamanho = inputTamanho.value;
    const nome = inputNome.value.trim();
    const whatsapp = inputWhatsapp.value.trim();

    // 1. Limpa os erros visuais de tentativas anteriores (Restaura o visual padrão)
    [inputTamanho, inputNome, inputWhatsapp].forEach(el => {
        el.classList.remove('is-invalid', 'border', 'border-danger');
        el.classList.add('border-0');
    });

    let temErro = false;

    // 2. Valida cada campo e aplica a borda vermelha se estiver vazio/incorreto
    if (!tamanho) {
        inputTamanho.classList.remove('border-0');
        inputTamanho.classList.add('is-invalid', 'border', 'border-danger');
        temErro = true;
    }
    
    if (!nome) {
        inputNome.classList.remove('border-0');
        inputNome.classList.add('is-invalid', 'border', 'border-danger');
        temErro = true;
    }
    
    // O WhatsApp precisa ter pelo menos 14 caracteres: (XX) XXXXX-XXXX
    if (!whatsapp || whatsapp.length < 14) {
        inputWhatsapp.classList.remove('border-0');
        inputWhatsapp.classList.add('is-invalid', 'border', 'border-danger');
        temErro = true;
    }

    // 3. Se houver erro, aborta o envio e mostra a notificação
    if (temErro) {
        return mostrarAvisoFlutuante("⚠️ Preencha corretamente os campos destacados em vermelho.", "warning");
    }

    // Efeito de carregamento no botão
    const btn = document.getElementById('btn-salvar-aviso');
    const txtOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> ENVIANDO...';

    // Monta o pacote de dados
    const payload = {
        sku: sku,
        nome: nomeProd,
        tamanho: tamanho,
        nomeCliente: nome,
        whatsapp: whatsapp
    };

    // Comunica com o Servidor (Google Apps Script via POST do fetch)
    fetch(API_URL + "?action=salvarAvisoProduto", {
        method: 'POST',
        body: JSON.stringify(payload)
    })
    .then(response => response.json())
    .then(res => {
        if(res.sucesso || res.success || res.retorno) {
            mostrarAvisoFlutuante("✅ Tudo certo! Avisaremos assim que o estoque for reposto.", "success");
            const m = bootstrap.Modal.getInstance(document.getElementById('modalAvisoEstoque'));
            if (m) m.hide(); // Fecha o modal
            btn.disabled = false;
            btn.innerHTML = txtOriginal;
        } else {
            throw new Error(res.erro || "Erro no servidor.");
        }
    })
    .catch(err => {
        mostrarAvisoFlutuante("❌ Erro ao enviar: " + err.message, "danger");
        btn.disabled = false;
        btn.innerHTML = txtOriginal;
    });
}
// Exibe um aviso flutuante elegante na Vitrine (Substitui os alerts nativos)
function mostrarAvisoFlutuante(mensagem, cor = 'success') {
  let container = document.getElementById('toast-container-global');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container-global';
    container.className = 'position-fixed top-0 end-0 p-4';
    container.style.zIndex = '10600'; // Z-index altíssimo para ficar acima de qualquer modal
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `alert alert-${cor} shadow-lg d-flex align-items-center alert-dismissible fade show`;
  toast.style.minWidth = '300px';
  toast.innerHTML = `
    <strong class="me-auto">${mensagem}</strong>
    <button type="button" class="btn-close ms-3" data-bs-dismiss="alert"></button>
  `;
  container.appendChild(toast);
  
  // Some automaticamente após 3 segundos
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 150);
  }, 3000);
}

// =================================================================================
// GATILHO E INJEÇÃO DO MODAL PROMOCIONAL 100% VIA JAVASCRIPT (NOVA DEMANDA)
// =================================================================================
/*
function injetarEExibirPromocao() {
    // Utiliza sessionStorage para garantir que só mostre 1 vez por visita
    var promoJaVista = sessionStorage.getItem('promoDiaDasMaesVista');
    
    if (!promoJaVista) {
        
        // 1. INJETAR TODO O CSS DIRETAMENTE NO <HEAD> DA PÁGINA
        var styleElement = document.createElement('style');
        styleElement.innerHTML = `
            // =================================================================================
               MODAL PROMOCIONAL - CSS (NOVA DEMANDA)
            // =================================================================================
            @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,300;0,700;0,900;1,700;1,900&family=Barlow:wght@300;400;600&display=swap');

            // 🔥 CORREÇÃO: Força a película preta a ficar por cima do cabeçalho/busca 🔥 //
            .modal-backdrop {
                z-index: 999998 !important;
            }
            #modalPromocao {
                z-index: 999999 !important;
           }

            :root {
              --pink: #ff1f78;
              --pink-mid: #ff4d9a;
              --pink-glow: rgba(255,31,120,0.55);
            }

            .banner-promo-custom {
              position: relative; 
              width: 100%; 
              min-height: 520px;
              background: #080808; 
              overflow: hidden;
              font-family: 'Barlow', sans-serif;
              color: white;
            }

            .banner-promo-custom * {
              box-sizing: border-box;
            }

            // grid //
            .grid-promo {
              position: absolute; inset: 0;
              background-image:
                linear-gradient(rgba(255,31,120,0.07) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,31,120,0.07) 1px, transparent 1px);
              background-size: 60px 60px; z-index: 1; pointer-events: none;
              animation: gridShift 10s linear infinite;
            }
            @keyframes gridShift { from{background-position:0 0,0 0} to{background-position:60px 60px,60px 60px} }

            // laser //
            .banner-promo-custom .laser {
              position: absolute; left: 0; right: 0; height: 2px;
              background: linear-gradient(90deg, transparent 0%, var(--pink) 30%, var(--pink-mid) 70%, transparent 100%);
              box-shadow: 0 0 18px var(--pink-glow); z-index: 3;
              animation: laserScan 5s ease-in-out infinite;
            }
            @keyframes laserScan { 0%{top:-4px;opacity:0} 5%{opacity:1} 95%{opacity:1} 100%{top:100%;opacity:0} }

            // diagonal pink block //
            .banner-promo-custom .diagonal-block {
              position: absolute; top: -80px; right: -60px;
              width: 50%; height: 700px;
              background: linear-gradient(135deg, var(--pink) 0%, #c4005e 100%);
              transform: skewX(-12deg); z-index: 2;
              clip-path: polygon(18% 0%, 100% 0%, 100% 100%, 0% 100%);
            }

            // pink glow //
            .banner-promo-custom .pink-glow {
              position: absolute; top: -100px; right: -120px;
              width: 580px; height: 800px;
              background: radial-gradient(ellipse, rgba(255,31,120,0.3) 0%, transparent 65%);
              z-index: 1; pointer-events: none;
              animation: glowPulse 3s ease-in-out infinite;
            }
            @keyframes glowPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.65;transform:scale(1.07)} }

            // logo //
            .banner-promo-custom .logo-area {
              position: absolute; top: 50%; right: 20px;
              transform: translateY(-50%);
              width: 370px; height: 370px; z-index: 4;
              opacity: 0; animation: popIn 0.7s cubic-bezier(0.34,1.56,0.64,1) forwards 0.5s;
              filter: drop-shadow(0 0 40px rgba(255,31,120,0.6));
            }
            .banner-promo-custom .logo-area img { width: 100%; object-fit: contain; }
            @keyframes popIn {
              from{opacity:0;transform:translateY(-50%) scale(0.85)}
              to{opacity:1;transform:translateY(-50%) scale(1)}
            }

            // top accent //
            .banner-promo-custom .top-accent {
              position: absolute; top: 0; left: 0; right: 0; height: 4px;
              background: linear-gradient(90deg, var(--pink) 0%, var(--pink-mid) 40%, transparent 100%);
              box-shadow: 0 0 14px var(--pink-glow); z-index: 20;
            }

            // corners //
            .banner-promo-custom .corner { position: absolute; width: 18px; height: 18px; z-index: 15; }
            .banner-promo-custom .corner.tl { top: 14px; left: 14px; border-top: 2px solid var(--pink); border-left: 2px solid var(--pink); }
            .banner-promo-custom .corner.tr { top: 14px; right: 14px; border-top: 2px solid var(--pink); border-right: 2px solid var(--pink); }
            .banner-promo-custom .corner.bl { bottom: 52px; left: 14px; border-bottom: 2px solid var(--pink); border-left: 2px solid var(--pink); }

            // left content //
            .left-promo {
                position: relative;
                z-index: 10;
                width: 60%;
                height: 100%;
                display: flex;
                flex-direction: column;
                justify-content: center;
                padding: 44px 30px 60px 52px;
            }

            .tag-promo { display:flex; align-items:center; gap:10px; margin-bottom:18px; opacity:0; animation:slideIn 0.5s ease forwards 0.15s; }
            .tag-bar { width:28px; height:3px; background:var(--pink); box-shadow:0 0 8px var(--pink-glow); }
            .tag-text { font-family:'Barlow Condensed',sans-serif; font-size:15px; font-weight:700; letter-spacing:6px; text-transform:uppercase; color:var(--pink); }

            .banner-promo-custom .brand { font-family:'Barlow Condensed',sans-serif; font-size:108px; font-weight:900; font-style:italic; line-height:0.85; text-transform:uppercase; color:#fff; letter-spacing:-2px; margin-bottom:4px; opacity:0; animation:slideIn 0.5s ease forwards 0.28s; }
            .banner-promo-custom .brand .hl { color:var(--pink); text-shadow:0 0 30px var(--pink-glow),0 0 60px rgba(255,31,120,0.3); }

            .sub-promo {
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 12px;
                font-weight: 300;
                letter-spacing: 8px;
                text-transform: uppercase;
                color: rgba(255, 255, 255);
                margin-bottom: 28px;
                opacity: 0;
                animation: slideIn 0.5s ease forwards 0.4s;
            }
            .divider-promo { display:flex; align-items:center; gap:10px; margin-bottom:24px; opacity:0; animation:slideIn 0.5s ease forwards 0.5s; }
            .div-line { width:36px; height:1px; background:var(--pink); opacity:0.5; }
            .div-dot  { width:5px; height:5px; border-radius:50%; background:var(--pink); box-shadow:0 0 8px var(--pink-glow); }

            .promo-section { margin-bottom:26px; opacity:0; animation:slideIn 0.5s ease forwards 0.62s; }
            .promo-eyebrow {
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 30px;
                font-weight: 700;
                letter-spacing: 5px;
                text-transform: uppercase;
                margin-bottom: 20px;
                justify-content: center;
            }
            .promo-big { display:flex; align-items:flex-end; line-height:1; }
            .promo-ate {
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 18px;
                font-weight: 700;
                font-style: italic;
                text-transform: uppercase;
                margin-bottom: 16px;
                margin-right: 8px;
                letter-spacing: 2px;
            }
            .promo-num { font-family:'Barlow Condensed',sans-serif; font-size:114px; font-weight:900; font-style:italic; color:var(--pink); line-height:1; text-shadow:0 0 40px var(--pink-glow),0 0 80px rgba(255,31,120,0.25); letter-spacing:-4px; margin: 0; }
            .promo-pct { font-family:'Barlow Condensed',sans-serif; font-size:50px; font-weight:900; font-style:italic; color:var(--pink); margin-bottom:14px; text-shadow:0 0 20px var(--pink-glow); }
            .promo-desc {
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 15px;
                font-weight: 400;
                letter-spacing: 5px;
                text-transform: uppercase;
                margin-top: 2px;
            }
            .validity { display:flex; align-items:center; gap:12px; opacity:0; animation:slideIn 0.5s ease forwards 0.78s; flex-wrap: wrap;}
            .validity-pill { background:rgba(255,31,120,0.15); border:1px solid rgba(255,31,120,0.35); border-radius:2px; padding:5px 12px; font-family:'Barlow Condensed',sans-serif; font-size:10px; font-weight:700; letter-spacing:3px; text-transform:uppercase; color:var(--pink-mid); }
            .validity-dates {
                font-family: 'Barlow', sans-serif;
                font-size: 14px;
                font-weight: 300;
                letter-spacing: 1px;
            }
            
            // Novo botão VER OFERTAS (Inicia oculto no Desktop) //
            .btn-ver-ofertas {
                display: none;
                margin-top: 20px;
                padding: 12px 24px;
                background-color: #ffffff;
                color: var(--pink);
                border: none;
                border-radius: 6px;
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 18px;
                font-weight: 900;
                letter-spacing: 3px;
                text-transform: uppercase;
                box-shadow: 0 4px 15px rgba(255,31,120,0.4);
                cursor: pointer;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            .btn-ver-ofertas:active {
                transform: scale(0.95);
            }

            // bottom bar //
            .bottom-bar-promo {
              position:absolute; bottom:0; left:0; right:0; height:44px;
              background:rgba(255,31,120,0.07); border-top:1px solid rgba(255,31,120,0.18);
              z-index:10; display:flex; align-items:center; padding:0 20px 0 52px; gap:14px;
              opacity:0; animation:fadeIn 0.6s ease forwards 1s;
            }
            .bb-dot { width:5px; height:5px; border-radius:50%; background:var(--pink); box-shadow:0 0 8px var(--pink-glow); animation:blink 1.5s ease-in-out infinite; }
            @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.2} }
            .bb-text {
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 19px;
                font-weight: 600;
                letter-spacing: 5px;
                text-transform: uppercase;
            }
            .bb-site {
                margin-left: auto;
                font-family: 'Barlow Condensed', sans-serif;
                font-size: 13px;
                font-weight: 700;
                letter-spacing: 4px;
                text-transform: uppercase;
            }
            // badge //
            .badge-promo {
              position:absolute; top:24px; right:24px; z-index:15;
              width:88px; height:88px; border-radius:50%;
              border:2px solid rgba(255,31,120,0.5);
              background:rgba(0,0,0,0.65);
              display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px;
              opacity:0; animation:fadeIn 0.8s ease forwards 1.1s;
              box-shadow:0 0 22px rgba(255,31,120,0.3),inset 0 0 20px rgba(255,31,120,0.05);
            }
            .badge-promo .badge-icon { font-size:20px; animation:pulse 2s ease-in-out infinite 1.5s; }
            @keyframes pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
            .badge-promo .badge-txt { font-family:'Barlow Condensed',sans-serif; font-size:10px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:var(--pink); text-align:center; line-height:1.4; }

            @keyframes slideIn { from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)} }
            @keyframes fadeIn  { from{opacity:0} to{opacity:1} }

            // =========================================
               RESPONSIVIDADE (MOBILE) AJUSTADA
               ========================================= //
            @media (max-width: 768px) {
              .left-promo {
                width: 100%;
                padding: 30px 20px 60px 20px;
                align-items: center;
                text-align: center;
              }
              .banner-promo-custom .diagonal-block {
                width: 100%;
                right: -50%;
              }
              .banner-promo-custom .logo-area {
                opacity: 0.85 !important; // Aumentado a opacidade da foto de fundo para ficar mais viva //
                height: 120px;
                right: -20px;
                top: 60%;
              }
              .banner-promo-custom .brand { font-size: 70px; } 
              
              // Tratamento das fontes que você aumentou no Desktop //
              .promo-eyebrow { font-size: 18px; margin-bottom: 10px; line-height: 1.2; }
              .promo-desc { font-size: 11px; margin-bottom: 5px; }
              .tag-text { font-size: 12px; }

              // 🔥 NOVO: Margem solicitada somente no mobile 🔥 //
              .promo-section { margin-bottom: 141px; }
              
              // Ajuste do agrupamento promo-big //
              .promo-big { justify-content: center; flex-wrap: wrap; align-items: baseline; gap: 4px; }
              .promo-num { font-size: 80px; }
              .promo-pct { font-size: 40px; }
              
              .badge-promo { width: 65px; height: 65px; top: 10px; right: 10px; }
              .badge-promo .badge-txt { font-size: 6px; letter-spacing: 1px; }
              .badge-promo .badge-icon { font-size: 14px; }
              
              // Tratamento do rodapé //
              .bottom-bar-promo { padding: 0 15px; justify-content: center;}
              .bb-text { font-size: 11px; white-space: normal; line-height: 1.2; text-align: center; }
              
              .validity { flex-direction: column; gap: 6px; }

              // 🔥 CORREÇÕES APLICADAS AQUI 🔥 //
              
              // 1. Melhora a cor do "VÁLIDO" para ficar legível por cima do fundo rosa //
              .validity-pill {
                  color: #ffffff !important;
                  border-color: rgba(255, 255, 255, 0.6) !important;
                  background: rgba(255, 255, 255, 0.15) !important;
              }

              // 2. Oculta o X no celular //
              .close-desktop-only { 
                  display: none !important; 
              }

              // 3. Mostra o botão de "VER OFERTAS" apenas no celular //
              .btn-ver-ofertas { 
                  display: block; 
                  width: 90%; 
                  margin-left: auto; 
                  margin-right: auto; 
              }
            }
        `;
        document.head.appendChild(styleElement);

        // 2. INJETAR TODO O HTML DIRETAMENTE NO <body> DA PÁGINA
        var modalContainer = document.createElement('div');
        modalContainer.innerHTML = `
            <!-- =================================================================================
                 MODAL PROMOCIONAL (NOVA DEMANDA)
                 ================================================================================= -->
            <div class="modal fade" id="modalPromocao" tabindex="-1" aria-labelledby="modalPromocaoLabel" aria-hidden="true" style="z-index: 10600;">
              <div class="modal-dialog modal-dialog-centered modal-lg">
                <div class="modal-content bg-transparent border-0 overflow-hidden rounded-4">
                  
                  <!-- 🔥 Botão de Fechar do Modal (X) - Agora com classe para esconder no mobile 🔥 -->
                  <button type="button" class="btn-close btn-close-white position-absolute top-0 end-0 m-3 close-desktop-only" data-bs-dismiss="modal" aria-label="Close" style="z-index: 9999;"></button>

                  <!-- INÍCIO DO SEU BANNER -->
                  <div class="banner-promo-custom">
                    <div class="top-accent"></div>
                    <div class="grid-promo"></div>
                    <div class="laser"></div>
                    <div class="pink-glow"></div>
                    <div class="diagonal-block"></div>
                    <div class="corner tl"></div>
                    <div class="corner tr"></div>
                    <div class="corner bl"></div>

                    <div class="logo-area">
                      <img src="https://fitney.com.br/img/monday.png" alt="FitNey"
                        onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'font-family:Barlow Condensed,sans-serif;font-size:90px;font-weight:900;font-style:italic;color:#ff1f78;text-shadow:0 0 40px rgba(255,31,120,0.6);letter-spacing:-2px\\'>FN</div>'">
                    </div>

                    <div class="badge-promo">
                      <div class="badge-icon">💗</div>
                      <div class="badge-txt">Dia<br>das<br>Mães</div>
                    </div>

                    <div class="left-promo">
                      <div class="tag-promo">
                        <div class="tag-bar"></div>
                        <div class="tag-text">Moda Fitness</div>
                      </div>
                      <div class="brand">Fit<span class="hl">Ney</span></div>
                      <div class="sub-promo">TREINE COM CONFIANÇA E ESTILO</div>
                      <div class="divider-promo">
                        <div class="div-line"></div>
                        <div class="div-dot"></div>
                      </div>
                      <div class="promo-section">
                        <div class="promo-eyebrow">⚡ Promoção Especial  Mês das Mães</div>
                        <div class="promo-desc">Produtos com</div>
                        <div class="promo-big">
                          <span class="promo-ate">até</span>
                          <span class="promo-num">20</span>
                          <span class="promo-pct">%</span>
                          <span class="promo-desc">de desconto.</span>
                        </div>
                      </div>
                      <div class="validity">
                        <div class="validity-pill">válido</div>
                        <div class="validity-dates">08 de maio &nbsp;→&nbsp; 15 de maio de 2026</div>
                        
                        <!-- 🔥 NOVO BOTÃO VER OFERTAS (Faz a mesma função do X de fechar o modal) 🔥 -->
                        <button type="button" class="btn-ver-ofertas" data-bs-dismiss="modal">VER OFERTAS</button>
                      </div>
                    </div>

                    <div class="bottom-bar-promo">
                      <div class="bb-dot"></div>
                      <div class="bb-text text-truncate">Oferta por tempo limitado &nbsp;·&nbsp; Não perca!</div>
                      <div class="bb-site d-none d-sm-block">fitney.com.br</div>
                    </div>
                  </div>
                  <!-- FIM DO SEU BANNER -->

                </div>
              </div>
            </div>
        `;
        document.body.appendChild(modalContainer);

        // 3. EXIBIR O MODAL (Aguarda 1 segundo após o site carregar)
        setTimeout(function() {
            var modalEl = document.getElementById('modalPromocao');
            if (modalEl && typeof bootstrap !== 'undefined') {
                var modalInstance = new bootstrap.Modal(modalEl);
                modalInstance.show();
                sessionStorage.setItem('promoDiaDasMaesVista', 'true');
                
                // 🔥 CORREÇÃO APLICADA: Força a remoção da tela preta e restaura a rolagem ao fechar
                modalEl.addEventListener('hidden.bs.modal', function () {
                    // Remove todas as películas pretas que o Bootstrap possa ter deixado presas
                    var backdrops = document.querySelectorAll('.modal-backdrop');
                    backdrops.forEach(function(b) { b.remove(); });
                    
                    // Restaura a rolagem do corpo da loja
                    document.body.classList.remove('modal-open');
                    document.body.style.overflow = '';
                    document.body.style.paddingRight = '';
                    
                    // Remove o container do modal da página (limpa a memória)
                    if (modalContainer && modalContainer.parentNode) {
                        modalContainer.parentNode.removeChild(modalContainer);
                    }
                });
            }
        }, 1000); 
    }
}
->
*/
// INJEÇÃO: Associa o gatilho ao evento window.onload sem apagar as funções originais
(function() {
    // Salva a função onload original (se existir)
    var originalOnLoad = window.onload;
    
    window.onload = function(e) {
        // Executa o que já existia antes
        if (originalOnLoad) {
            originalOnLoad(e);
        }
        // Dispara a nova função promocional 100% injetada via JS
        injetarEExibirPromocao();
    };
})();

/**=================================================================================*/