const axios = require('axios');
const cron = require('node-cron');
const tough = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const moment = require('moment-timezone');
require('dotenv').config();

// Configuração inicial do cliente HTTP com gerenciamento de cookies
const cookieJar = new tough.CookieJar();
const client = wrapper(axios.create({ 
  jar: cookieJar,
  withCredentials: true
}));

// Logger simplificado com níveis de severidade
const logger = {
  info: (...args) => console.log(`[INFO] ${moment().tz(config.timezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ')}`, ...args),
  error: (...args) => console.error(`[ERROR] ${moment().tz(config.timezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ')}`, ...args),
  debug: (...args) => process.env.DEBUG === 'true' && console.log(`[DEBUG] ${moment().tz(config.timezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ')}`, ...args)
};

// Configurações do sistema
const config = {
  user: process.env.USER,
  password: process.env.PASSWORD,
  timezone: process.env.TZ || 'America/Sao_Paulo',
  schedules: process.env.SCHEDULES ? process.env.SCHEDULES.split(',') : [],
  weekdays: process.env.WEEKDAYS || '*',
  randomOffset: parseInt(process.env.RANDOM_OFFSET || '300', 10),
  vacationStart: process.env.VACATION_START ? 
    moment.tz(process.env.VACATION_START, 'YYYY-MM-DD', process.env.TZ || 'America/Sao_Paulo') : null,
  vacationEnd: process.env.VACATION_END ? 
    moment.tz(process.env.VACATION_END, 'YYYY-MM-DD', process.env.TZ || 'America/Sao_Paulo') : null,
  webhookUrl: process.env.WEBHOOK_URL,
  maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10)
};

// Função para formatar a expressão cron
function formatCronSchedule(cronExpression) {
  const weekDaysMap = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const parts = cronExpression.split(' ');
  
  const [minute, hour] = parts.slice(0, 2);
  const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
  
  const days = parts[4];
  if (days === '*') return { time, days: 'Todos os dias' };
  
  const formattedDays = days.split(',').map(part => {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(d => {
        const day = parseInt(d) % 7;
        return weekDaysMap[day];
      });
      return `${start}-${end}`;
    }
    return weekDaysMap[parseInt(part) % 7];
  }).join(', ');

  return { time, days: formattedDays };
}

// Função para verificar se está em período de férias
function isVacationPeriod() {
  if (!config.vacationStart || !config.vacationEnd) return false;
  
  const now = moment().tz(config.timezone);
  return now.isBetween(config.vacationStart, config.vacationEnd, null, '[]');
}

// Validação das variáveis de ambiente
function validateConfig() {
  const requiredEnvVars = ['USER', 'PASSWORD', 'SCHEDULES', 'WEEKDAYS'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    logger.error(`Variáveis de ambiente ausentes: ${missingVars.join(', ')}`);
    process.exit(1);
  }

  if (!process.env.SCHEDULES.match(/^(\d{1,2}:\d{2})(,\d{1,2}:\d{2})*$/)) {
    logger.error('Formato inválido para SCHEDULES. Use "HH:mm,HH:mm,..."');
    process.exit(1);
  }

  if (process.env.WEEKDAYS && !/^(\*|\d+(-\d+)?)(,\d+(-\d+)?)*$/.test(process.env.WEEKDAYS)) {
    logger.error('Formato inválido para WEEKDAYS. Use "1-5" ou "0,6" ou "*"');
    process.exit(1);
  }

  if ((process.env.VACATION_START && !process.env.VACATION_END) || (!process.env.VACATION_START && process.env.VACATION_END)) {
    logger.error('Ambas VACATION_START e VACATION_END devem ser definidas para o período de férias');
    process.exit(1);
  }

  if (process.env.VACATION_START && !moment(process.env.VACATION_START, moment.ISO_8601, true).isValid()) {
    logger.error('Formato inválido para VACATION_START. Use o formato ISO 8601 (YYYY-MM-DD)');
    process.exit(1);
  }

  if (process.env.VACATION_END && !moment(process.env.VACATION_END, moment.ISO_8601, true).isValid()) {
    logger.error('Formato inválido para VACATION_END. Use o formato ISO 8601 (YYYY-MM-DD)');
    process.exit(1);
  }

  if (config.schedules.length === 0) {
    logger.error('Nenhum horário definido em SCHEDULES');
    process.exit(1);
  }
}

/**
 * Autentica na plataforma Senior e obtém token de acesso
 * @returns {Promise<string>} Token de autenticação
 */
async function authenticate() {
  logger.info('Iniciando processo de autenticação');
  
  try {
    const params = new URLSearchParams();
    params.append('user', config.user);
    params.append('password', config.password);

    // Executa a requisição de login
    const response = await client.post(
      'https://platform.senior.com.br/auth/LoginServlet',
      params.toString(),
      {
        headers: {
          'Origin': 'https://platform.senior.com.br',
          'Content-Type': 'application/x-www-form-urlencoded',
          'Upgrade-Insecure-Requests': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36'
        }
      }
    );
  
    // Extrai o cookie codificado
    const cookies = cookieJar.getCookiesSync('https://platform.senior.com.br');
    const tokenCookie = cookies.find(c => c.key === 'com.senior.token');

    if (!tokenCookie) {
      throw new Error('Cookie com.senior.token não encontrado');
    }

    // Decodifica o token URL-encoded
    const decodedToken = decodeURIComponent(tokenCookie.value);
    // Converte para objeto JSON
    const tokenData = JSON.parse(decodedToken);
    
    logger.info('Token obtido com sucesso');
    return tokenData.access_token;

  } catch (error) {
    logger.error('Falha na autenticação:', error.message);
    throw new Error(`Erro ao obter token: ${error.message}`);
  }
}

/**
 * Obtém os dados do usuário e da empresa autenticado
 * @param {string} token - Token de autenticação
 * @returns {Promise<Object>} Dados do usuário em formato JSON
 */
async function getUserData(token) {
  logger.info('Iniciando consulta de dados do usuário e da empresa');
  
  try {
    const response = await client.post(
      'https://platform.senior.com.br/t/senior.com.br/bridge/1.0/rest/hcm/pontomobile/queries/employeeByUserQuery',
      {},
      {
        headers: {
          'Authorization': `bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36',
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('Dados do usuário e da empresa obtidos com sucesso');
    logger.debug('Resposta completa:', response.data.employee);
    
    return response.data.employee;

  } catch (error) {
    logger.error('Falha ao obter dados do usuário:', error.message);
    throw new Error(`Erro na consulta de dados: ${error.response?.data?.message || error.message}`);
  }
}


/**
 * Realiza a marcação de ponto na plataforma
 * @param {string} token - Token de autenticação
 * @param {number} attempt - Número da tentativa atual
 * @returns {Promise<Object>} Resposta da API
 */
async function punchClock(token, attempt = 1) {
  logger.info(`Tentativa ${attempt} de marcação de ponto`);

  const userData = await getUserData(token);

  const clockingData = {
    clockingInfo: {
      company: {
        id: userData.company.id,
        arpId: userData.company.arpId,
        identifier: userData.company.cnpj,
        caepf: userData.company.caepf,
        cnoNumber: userData.company.cnoNumber
      },
      employee: {
        id: userData.id,
        arpId: userData.arpId,
        cpf: userData.cpfNumber,
        pis: userData.pis
      },
      appVersion: "3.12.3",
      timeZone: userData.company.timeZone,
      signature: {
        signatureVersion: 1,
        signature: "N2IyZTNhYzUyOWFhNmM4YTUzM2U2YzEzMDM1MDk4NmY5MGM3MDQ0YTFkZDNhMzJjMGViZDBkM2EwZjFhYjk0Zg=="
      },
      use: "02"
    }
  };
  
  try {
    const response = await client.post(
      'https://platform.senior.com.br/t/senior.com.br/bridge/1.0/rest/hcm/pontomobile_clocking_event/actions/clockingEventImportByBrowser', clockingData,
      {
        headers: {
          'Authorization': `bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.86 Safari/537.36'
        }
      }
    );

    logger.info('Marcação de ponto registrada com sucesso');
    logger.debug('Resposta completa:', response.data);

    return response.data;

  } catch (error) {
    logger.error(`Erro na tentativa ${attempt}:`, error.message);
    
    if (attempt < config.maxRetries) {
      logger.info(`Nova tentativa em 5 segundos...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return punchClock(token, attempt + 1);
    }
    
    throw new Error(`Falha após ${config.maxRetries} tentativas: ${error.message}`);
  }
}

/**
 * Envia notificação para webhook
 * @param {Object} data - Dados a serem enviados
 */
async function sendWebhook(data) {
  if (!config.webhookUrl) return;

  try {
    await axios.post(config.webhookUrl, {
      timestamp: moment().tz(config.timezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
      ...data
    });
    logger.info('Notificação enviada para webhook');
  } catch (error) {
    logger.error('Erro ao enviar webhook:', error.message);
  }
}

/**
 * Agenda e executa as marcações de ponto com variação temporal
 */
function schedulePunches() {
  logger.info(`Serão realizadas ${config.schedules.length} marcações de ponto nos dias estabelecidos`);

  if (config.vacationStart && config.vacationEnd) {
    logger.info(`Modo férias ativo: ${config.vacationStart.format('DD/MM/YYYY')} - ${config.vacationEnd.format('DD/MM/YYYY')}`);
  }

  config.schedules.forEach((schedule, index) => {
    const [hour, minute] = schedule.split(':');
    const cronExpression = `${minute} ${hour} * * ${config.weekdays}`;

    const { time, days } = formatCronSchedule(cronExpression);

    logger.info(`(${index + 1}/${config.schedules.length}) ${days} às ${time}`);

    cron.schedule(cronExpression, async () => {
      try {
        // Verifica período de férias
        if (isVacationPeriod()) {
          logger.info('Período de férias - Marcação ignorada');
          await sendWebhook({
            status: 'skipped',
            reason: 'Modo férias ativo',
            scheduledTime: moment().tz(config.timezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ')
          });
          return;
        }
        
        // Calcula variação temporal
        const offset = Math.floor(Math.random() * config.randomOffset * 2) - config.randomOffset;
        const baseTime = moment().tz(config.timezone).set({ hour, minute, second: 0, millisecond: 0 });
        const punchTime = baseTime.clone().add(offset, 'seconds');

        // Agendamento preciso com setTimeout
        const delay = punchTime.diff(moment().tz(config.timezone), 'milliseconds');

        logger.info(`Agendando para ${punchTime.format('HH:mm:ss')} (offset: ${offset}s)`);
        logger.debug(`Aguardando ${delay} ms para marcação`);

        setTimeout(async () => {
          try {
            const token = await authenticate();
            const result = await punchClock(token);

            await sendWebhook({
              status: 'success',
              scheduledTime: baseTime.format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
              executionTime: moment().tz(config.timezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
              offsetSeconds: offset,
              response: result
            });

          } catch (error) {
            logger.error(`Falha no processo de marcação: ${error.message}`);
            await sendWebhook({
              status: 'error',
              scheduledTime: baseTime.format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
              executionTime: moment().tz(config.timezone).format('YYYY-MM-DDTHH:mm:ss.SSSZ'),
              offsetSeconds: offset,
              error: error.message
            });
          }
        }, Math.max(delay, 0));

      } catch (error) {
        logger.error(`Erro no agendamento: ${error.message}`);
        sendWebhook({
          status: 'error',
          error: `Erro no agendamento: ${error.message}`
        });
      }
    });
  });
}

/**
 * Fluxo principal da aplicação
 */
async function main() {
  try {
    validateConfig();
    logger.info('Iniciando serviço de marcação de ponto automática');
    schedulePunches();
    
    // Mantém o processo ativo
    setInterval(() => {
      logger.debug('Serviço em execução...');
    }, 60000);

  } catch (error) {
    logger.error('Falha crítica na inicialização:', error.message);
    process.exit(1);
  }
}

// Inicia a aplicação
main();
