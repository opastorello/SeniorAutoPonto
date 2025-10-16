const axios = require('axios');
const cron = require('node-cron');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const moment = require('moment-timezone');
require('dotenv').config();

const cookieJar = new tough.CookieJar();
const client = wrapper(axios.create({ jar: cookieJar, withCredentials: true }));

/**
 * Configurações principais do sistema obtidas de variáveis de ambiente.
 * @constant {Object} config
 */
const config = {
  user: process.env.USER,
  password: process.env.PASSWORD,
  timezone: process.env.TZ || 'America/Sao_Paulo',
  schedules: process.env.SCHEDULES ? process.env.SCHEDULES.split(',') : [],
  weekdays: process.env.WEEKDAYS || '*',
  randomOffset: parseInt(process.env.RANDOM_OFFSET || '300', 10),
  vacationStart: process.env.VACATION_START
    ? moment.tz(process.env.VACATION_START, 'YYYY-MM-DD', process.env.TZ || 'America/Sao_Paulo')
    : null,
  vacationEnd: process.env.VACATION_END
    ? moment.tz(process.env.VACATION_END, 'YYYY-MM-DD', process.env.TZ || 'America/Sao_Paulo')
    : null,
  webhookUrl: process.env.WEBHOOK_URL || null,
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10)
};

/**
 * Logger centralizado com suporte a níveis de severidade.
 * Controlado por variável de ambiente DEBUG.
 */
const logger = {
  info: (...args) => console.log(`[INFO] ${moment().tz(config.timezone).format('YYYY-MM-DD HH:mm:ss')}`, ...args),
  error: (...args) => console.error(`[ERROR] ${moment().tz(config.timezone).format('YYYY-MM-DD HH:mm:ss')}`, ...args),
  debug: (...args) => process.env.DEBUG === 'true' && console.log(`[DEBUG] ${moment().tz(config.timezone).format('YYYY-MM-DD HH:mm:ss')}`, ...args)
};

/**
 * Valida as variáveis de ambiente obrigatórias e o formato dos parâmetros.
 * Interrompe a execução em caso de erro crítico.
 */
function validateConfig() {
  const requiredVars = ['USER', 'PASSWORD', 'SCHEDULES'];
  const missing = requiredVars.filter(v => !process.env[v]);

  if (missing.length > 0) {
    logger.error(`Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (!/^\d{1,2}:\d{2}(,\d{1,2}:\d{2})*$/.test(process.env.SCHEDULES)) {
    logger.error('Formato inválido para SCHEDULES. Use "HH:mm,HH:mm,..."');
    process.exit(1);
  }

  if ((config.vacationStart && !config.vacationEnd) || (!config.vacationStart && config.vacationEnd)) {
    logger.error('Ambas VACATION_START e VACATION_END devem ser definidas para o modo férias.');
    process.exit(1);
  }

  if (config.vacationStart && !moment(config.vacationStart, moment.ISO_8601, true).isValid()) {
    logger.error('Formato inválido para VACATION_START. Use YYYY-MM-DD.');
    process.exit(1);
  }

  if (config.vacationEnd && !moment(config.vacationEnd, moment.ISO_8601, true).isValid()) {
    logger.error('Formato inválido para VACATION_END. Use YYYY-MM-DD.');
    process.exit(1);
  }
}

/**
 * Verifica se o sistema está em período de férias.
 * @returns {boolean} True se a data atual estiver dentro do intervalo definido.
 */
function isVacationPeriod() {
  if (!config.vacationStart || !config.vacationEnd) return false;
  const now = moment().tz(config.timezone);
  return now.isBetween(config.vacationStart, config.vacationEnd, null, '[]');
}

/**
 * Autentica o usuário na plataforma Senior e obtém o token de acesso.
 * @returns {Promise<string>} Token de autenticação JWT.
 */
async function authenticate() {
  logger.info('Autenticando na plataforma Senior...');

  try {
    const params = new URLSearchParams();
    params.append('user', config.user);
    params.append('password', config.password);

    await client.post('https://platform.senior.com.br/auth/LoginServlet', params.toString(), {
      headers: {
        'Origin': 'https://platform.senior.com.br',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const cookies = cookieJar.getCookiesSync('https://platform.senior.com.br');
    const tokenCookie = cookies.find(c => c.key === 'com.senior.token');

    if (!tokenCookie) throw new Error('Cookie com.senior.token não encontrado');

    const decoded = decodeURIComponent(tokenCookie.value);
    const tokenData = JSON.parse(decoded);

    logger.info('Autenticação concluída com sucesso.');
    return tokenData.access_token;

  } catch (error) {
    logger.error('Erro na autenticação:', error.message);
    throw new Error(`Falha ao autenticar: ${error.message}`);
  }
}

/**
 * Consulta os dados do colaborador autenticado.
 * @param {string} token Token de autenticação JWT.
 * @returns {Promise<Object>} Dados do colaborador.
 */
async function getUserData(token) {
  logger.info('Consultando dados do usuário...');
  try {
    const res = await client.post(
      'https://platform.senior.com.br/t/senior.com.br/bridge/1.0/rest/hcm/pontomobile/queries/employeeByUserQuery',
      {},
      { headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return res.data.employee;
  } catch (err) {
    throw new Error(`Falha ao obter dados do usuário: ${err.response?.data?.message || err.message}`);
  }
}

/**
 * Executa o registro de ponto na plataforma.
 * Inclui tentativas automáticas em caso de erro.
 * 
 * @param {string} token Token de autenticação.
 * @param {number} [attempt=1] Número da tentativa atual.
 * @returns {Promise<Object>} Resposta da API após sucesso.
 */
async function punchClock(token, attempt = 1) {
  logger.info(`Tentando marcar ponto (tentativa ${attempt})`);

  const userData = await getUserData(token);
  const payload = {
    clockingInfo: {
      company: {
        id: userData.company.id,
        arpId: userData.company.arpId,
        identifier: userData.company.cnpj
      },
      employee: {
        id: userData.id,
        arpId: userData.arpId,
        cpf: userData.cpfNumber,
        pis: userData.pis
      },
      appVersion: '3.12.3',
      timeZone: userData.company.timeZone,
      signature: {
        signatureVersion: 1,
        signature: 'N2IyZTNhYzUyOWFhNmM4YTUzM2U2YzEzMDM1MDk4NmY5MGM3MDQ0YTFkZDNhMzJjMGViZDBkM2EwZjFhYjk0Zg=='
      },
      use: '02'
    }
  };

  try {
    const res = await client.post(
      'https://platform.senior.com.br/t/senior.com.br/bridge/1.0/rest/hcm/pontomobile_clocking_event/actions/clockingEventImportByBrowser',
      payload,
      { headers: { Authorization: `bearer ${token}` } }
    );
    logger.info('Ponto registrado com sucesso.');
    return res.data;
  } catch (err) {
    logger.error(`Erro tentativa ${attempt}: ${err.message}`);
    if (attempt < config.maxRetries) {
      logger.info('Tentando novamente em 5 segundos...');
      await new Promise(r => setTimeout(r, 5000));
      return punchClock(token, attempt + 1);
    }
    throw new Error(`Falha após ${config.maxRetries} tentativas: ${err.message}`);
  }
}

/**
 * Envia logs de execução para o Webhook configurado.
 * Ignorado se WEBHOOK_URL não estiver definida.
 * 
 * @param {Object} data Dados de log ou evento.
 */
async function sendWebhook(data) {
  if (!config.webhookUrl) return;

  try {
    await axios.post(config.webhookUrl, {
      timestamp: moment().tz(config.timezone).format(),
      ...data
    });
    logger.debug('Webhook enviado com sucesso.');
  } catch (error) {
    logger.error('Falha ao enviar webhook:', error.message);
  }
}

/**
 * Agenda as marcações de ponto automáticas.
 * Executa a cada minuto, verificando se o horário atual
 * está dentro da janela de execução ajustada por offset.
 */
function schedulePunches() {
  logger.info(`Agendamento iniciado. ${config.schedules.length} horários configurados: ${config.schedules.join(', ')}`);
  if (config.vacationStart && config.vacationEnd)
    logger.info(`Modo férias ativo: ${config.vacationStart.format('DD/MM/YYYY')} → ${config.vacationEnd.format('DD/MM/YYYY')}`);

  cron.schedule('* * * * *', async () => {
    const now = moment().tz(config.timezone);

    for (const schedule of config.schedules) {
      const [hour, minute] = schedule.split(':').map(Number);
      const baseTime = moment().tz(config.timezone).set({ hour, minute, second: 0, millisecond: 0 });
      const offset = Math.floor(Math.random() * config.randomOffset * 2) - config.randomOffset;
      const punchTime = baseTime.clone().add(offset, 'seconds');

      // Executa se o horário atual estiver dentro da janela ajustada
      if (now.isBetween(punchTime.clone().subtract(30, 'seconds'), punchTime.clone().add(30, 'seconds'))) {
        if (isVacationPeriod()) {
          logger.info('Modo férias ativo — marcação ignorada.');
          await sendWebhook({ status: 'skipped', reason: 'vacation_period', scheduled: punchTime.format() });
          continue;
        }

        logger.info(`Executando marcação: base ${baseTime.format('HH:mm')} | offset ${offset}s | efetiva ${punchTime.format('HH:mm:ss')}`);
        try {
          const token = await authenticate();
          const result = await punchClock(token);
          await sendWebhook({
            status: 'success',
            baseTime: baseTime.format(),
            executed: now.format(),
            offsetSeconds: offset,
            response: result
          });
        } catch (error) {
          logger.error(`Erro ao marcar ponto: ${error.message}`);
          await sendWebhook({
            status: 'error',
            baseTime: baseTime.format(),
            executed: now.format(),
            offsetSeconds: offset,
            error: error.message
          });
        }
      }
    }
  });
}

/**
 * Função principal do sistema.
 * Valida configurações e inicializa o agendador.
 */
async function main() {
  try {
    validateConfig();
    logger.info('Serviço de marcação automática iniciado.');
    schedulePunches();

    // Mantém processo ativo para execuções contínuas
    setInterval(() => {
      logger.debug('Serviço rodando...');
    }, 60000);
  } catch (error) {
    logger.error('Falha crítica na inicialização:', error.message);
    process.exit(1);
  }
}

main();
