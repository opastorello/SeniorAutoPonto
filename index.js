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
  weekdays: process.env.WEEKDAYS || '*', // aceita "*", "1-5", "0,6", "1,2,3,4,5", etc.
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
 * Analisa a string WEEKDAYS e retorna um Set com dias permitidos.
 * Convenção: Sunday=0, Monday=1, ..., Saturday=6.
 * Aceita 7 como domingo (convertido para 0).
 *
 * Exemplos:
 *  - "*": todos os dias
 *  - "1-5": seg–sex
 *  - "0,6": dom e sáb
 *  - "1,2,3,4,5": seg–sex
 *
 * @param {string} pattern Ex.: "*", "1-5", "0,6"
 * @returns {{ all:boolean, days:Set<number> }}
 */
function parseWeekdaysPattern(pattern) {
  if (!pattern || pattern.trim() === '*' ) {
    return { all: true, days: new Set() };
  }

  const parts = pattern.split(',');
  const days = new Set();

  for (const part of parts) {
    if (part.includes('-')) {
      const [startStr, endStr] = part.split('-');
      let start = parseInt(startStr, 10);
      let end = parseInt(endStr, 10);
      if (Number.isNaN(start) || Number.isNaN(end)) throw new Error('WEEKDAYS inválido (intervalo não numérico).');
      if (start === 7) start = 0;
      if (end === 7) end = 0;

      // intervalos devem ser “lineares” no padrão (sem wrap-around)
      if (start > end && !(start === 0 && end === 0)) {
        throw new Error('WEEKDAYS inválido: intervalos devem ser crescentes (ex.: "1-5").');
      }
      for (let d = start; d <= end; d++) days.add(d % 7);
    } else {
      let d = parseInt(part, 10);
      if (Number.isNaN(d)) throw new Error('WEEKDAYS inválido (token não numérico).');
      if (d < 0 || d > 7) throw new Error('WEEKDAYS inválido: dias devem estar entre 0 e 7.');
      if (d === 7) d = 0;
      days.add(d);
    }
  }

  return { all: false, days };
}

/**
 * Valida as variáveis obrigatórias e formatos.
 * Interrompe a execução em caso de erro crítico.
 */
function validateConfig() {
  const required = ['USER', 'PASSWORD', 'SCHEDULES'];
  const missing = required.filter(v => !process.env[v]);
  if (missing.length) {
    logger.error(`Variáveis obrigatórias ausentes: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (!/^\d{1,2}:\d{2}(,\d{1,2}:\d{2})*$/.test(process.env.SCHEDULES)) {
    logger.error('Formato inválido para SCHEDULES. Use "HH:mm,HH:mm,..."');
    process.exit(1);
  }

  // WEEKDAYS: aceita "*", ou lista/intervalos de números 0-7 (7=domingo)
  if (!/^(\*|[0-7](-[0-7])?(,[0-7](-[0-7])?)*)$/.test(config.weekdays)) {
    logger.error('Formato inválido para WEEKDAYS. Exemplos válidos: "*", "1-5", "0,6", "1,2,3,4,5".');
    process.exit(1);
  }

  // valida férias (ambos ou nenhum)
  if ((config.vacationStart && !config.vacationEnd) || (!config.vacationStart && config.vacationEnd)) {
    logger.error('Defina VACATION_START e VACATION_END juntos.');
    process.exit(1);
  }
  if (config.vacationStart && !moment(config.vacationStart, moment.ISO_8601, true).isValid()) {
    logger.error('VACATION_START inválido. Use YYYY-MM-DD.');
    process.exit(1);
  }
  if (config.vacationEnd && !moment(config.vacationEnd, moment.ISO_8601, true).isValid()) {
    logger.error('VACATION_END inválido. Use YYYY-MM-DD.');
    process.exit(1);
  }
}

/**
 * Indica se hoje é um dia permitido conforme WEEKDAYS.
 * @param {moment.Moment} now Momento atual com timezone aplicado.
 * @param {{all:boolean, days:Set<number>}} wd Dias permitidos.
 * @returns {boolean}
 */
function isAllowedWeekday(now, wd) {
  if (wd.all) return true;
  const dow = now.day(); // 0..6 (0=domingo)
  return wd.days.has(dow);
}

/**
 * Retorna true se hoje está no período de férias (inclusive).
 * @returns {boolean}
 */
function isVacationPeriod() {
  if (!config.vacationStart || !config.vacationEnd) return false;
  const now = moment().tz(config.timezone);
  return now.isBetween(config.vacationStart, config.vacationEnd, null, '[]');
}

/**
 * Autentica na plataforma Senior e retorna token de acesso.
 * @returns {Promise<string>}
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
 * Obtém dados do colaborador autenticado.
 * @param {string} token
 * @returns {Promise<Object>}
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
 * Realiza a marcação de ponto; inclui retentativas.
 * @param {string} token
 * @param {number} [attempt=1]
 * @returns {Promise<Object>}
 */
async function punchClock(token, attempt = 1) {
  logger.info(`Marcando ponto (tentativa ${attempt})`);
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
      logger.info('Nova tentativa em 5 segundos...');
      await new Promise(r => setTimeout(r, 5000));
      return punchClock(token, attempt + 1);
    }
    throw new Error(`Falha após ${config.maxRetries} tentativas: ${err.message}`);
  }
}

/**
 * Envia evento ao Webhook (se configurado).
 * @param {Object} data
 * @returns {Promise<void>}
 */
async function sendWebhook(data) {
  if (!config.webhookUrl) return;
  try {
    await axios.post(config.webhookUrl, {
      timestamp: moment().tz(config.timezone).format(),
      ...data
    });
    logger.debug('Webhook enviado.');
  } catch (error) {
    logger.error('Falha ao enviar webhook:', error.message);
  }
}

/**
 * Agenda as marcações a cada minuto, respeitando WEEKDAYS e OFFSET.
 * - Se hoje não for dia permitido, não executa nada.
 * - Para cada horário base, calcula um offset aleatório em ±RANDOM_OFFSET
 *   e executa quando o "now" cair na janela de ±30s do "punchTime".
 */
function schedulePunches() {
  const parsedWd = parseWeekdaysPattern(config.weekdays);
  logger.info(
    `Agendamento ativo | Horários: ${config.schedules.join(', ')} | WEEKDAYS: ${config.weekdays} | TZ: ${config.timezone}`
  );
  if (config.vacationStart && config.vacationEnd) {
    logger.info(`Férias: ${config.vacationStart.format('DD/MM/YYYY')} → ${config.vacationEnd.format('DD/MM/YYYY')}`);
  }

  cron.schedule('* * * * *', async () => {
    const now = moment().tz(config.timezone);

    // Respeita WEEKDAYS
    if (!isAllowedWeekday(now, parsedWd)) {
      logger.debug(`Dia ${now.day()} não permitido por WEEKDAYS (${config.weekdays}).`);
      return;
    }

    for (const schedule of config.schedules) {
      const [hour, minute] = schedule.split(':').map(Number);
      const baseTime = moment().tz(config.timezone).set({ hour, minute, second: 0, millisecond: 0 });

      // Calcula offset aleatório (±RANDOM_OFFSET segundos)
      const offset = Math.floor(Math.random() * config.randomOffset * 2) - config.randomOffset;
      const punchTime = baseTime.clone().add(offset, 'seconds');

      // Executa se estamos na janela de ±30s do horário calculado
      if (now.isBetween(punchTime.clone().subtract(30, 'seconds'), punchTime.clone().add(30, 'seconds'))) {
        if (isVacationPeriod()) {
          logger.info('Período de férias — marcação ignorada.');
          await sendWebhook({ status: 'skipped', reason: 'vacation_period', scheduled: punchTime.toISOString() });
          continue;
        }

        logger.info(
          `Execução: base ${baseTime.format('HH:mm')} | offset ${offset}s | efetiva ${punchTime.format('HH:mm:ss')}`
        );

        try {
          const token = await authenticate();
          const result = await punchClock(token);
          await sendWebhook({
            status: 'success',
            baseTime: baseTime.toISOString(),
            executed: now.toISOString(),
            offsetSeconds: offset,
            response: result
          });
        } catch (error) {
          logger.error(`Erro ao marcar ponto: ${error.message}`);
          await sendWebhook({
            status: 'error',
            baseTime: baseTime.toISOString(),
            executed: now.toISOString(),
            offsetSeconds: offset,
            error: error.message
          });
        }
      }
    }
  });
}

/**
 * Ponto de entrada: valida config e inicia agendamento.
 */
async function main() {
  try {
    validateConfig();
    schedulePunches();

    // Mantém processo ativo com heartbeat opcional
    setInterval(() => {
      logger.debug('Heartbeat: serviço ativo.');
    }, 60000);
  } catch (error) {
    logger.error('Falha crítica na inicialização:', error.message);
    process.exit(1);
  }
}

main();
