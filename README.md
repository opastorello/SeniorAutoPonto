# SeniorAutoPonto 🕒

Sistema automático de marcação de ponto para a plataforma Senior, com Docker, cron jobs inteligentes e notificações via webhook.

## Funcionalidades Principais ✅

- **Marcação automática de ponto** na plataforma Senior
- **Agendamento flexível** com sintaxe cron
- **Variação temporal aleatória** para evitar padrões
- **Modo férias** para ignorar marcações em períodos específicos
- **Tentativas de reconexão** automáticas
- Notificações via **Webhook** (Discord/Slack/MS Teams)
- Gerenciamento seguro de **sessões e cookies**
- Logs detalhados com níveis de depuração
- Configuração via **variáveis de ambiente**

## Instalação 🚀

1. Clone o repositório:
```bash
git clone https://github.com/opastorello/SeniorAutoPonto.git
cd SeniorAutoPonto
```

2. Crie o arquivo de configuração \`.env\`:
```bash
cp .env.example .env
```

3. Edite o \`.env\` com suas credenciais:
```env
USER=seu.usuario@empresa.com
PASSWORD=suaSenhaSegura123
TZ=America/Sao_Paulo
SCHEDULES=08:00,12:00,13:00,17:30
WEEKDAYS=1-5
```

## Configuração ⚙️

| Variável          | Descrição                                                                 |
|-------------------|---------------------------------------------------------------------------|
| USER              | Email de acesso à plataforma Senior                                      |
| PASSWORD          | Senha da plataforma Senior                                               |
| SCHEDULES         | Horários de marcação (ex: "08:00,12:00")                                 |
| WEEKDAYS          | Dias da semana (0=Domingo, 1=Segunda..., ex: "1-5" para dias úteis)      |
| TZ                | Fuso horário para marcação do ponto (padrão: America/Sao_Paulo)          |
| RANDOM_OFFSET     | Variação máxima em segundos (padrão: 300)                                |
| VACATION_START	  | Data de início das férias (formato: YYYY-MM-DD, opcional)                |
| VACATION_END	    | Data de término das férias (formato: YYYY-MM-DD, opcional)               |
| WEBHOOK_URL       | URL para notificações (opcional)                                         |
| DEBUG             | Habilita logs detalhados (true/false)                                    |
| MAX_RETRIES       | Máximo de tentativas por marcação (padrão: 3)                           |

## Execução com Docker 🐳

```bash
docker build -t senior-auto-ponto .
docker run --restart=always -d --name senior-auto-ponto --env-file .env senior-auto-ponto
```

## Monitoramento 📊

Verifique os logs em tempo real:
```bash
docker logs -f senior-auto-ponto
```

Exemplo de saída:
```
[INFO] 2025-02-03T09:00:00.000-03:00 Agendando para 08:57:32 (offset: -148s)
[INFO] 2025-02-03T09:00:00.000-03:00 Marcação de ponto registrada com sucesso
```

## Notificações via Webhook 🔔

O sistema envia payloads JSON para seu webhook:

**Sucesso:**
```json
{
  "status": "success",
  "scheduledTime": "2025-02-02T08:00:00.000Z",
  "executionTime": "2025-02-02T08:02:32.123Z",
  "offsetSeconds": -148,
  "response": { ... }
}
```

**Erro:**
```json
{
  "status": "error",
  "scheduledTime": "2025-02-02T12:00:00.000Z",
  "error": "Falha na autenticação",
  "attempts": 3
}
```

## Segurança 🔒

- Credenciais armazenadas somente em variáveis de ambiente
- Sessões protegidas com gerenciamento de cookies seguro
- Atualizações regulares de dependências via Docker

## Solução de Problemas 🛠️

Problemas comuns:
1. **Credenciais inválidas**
   - Verifique usuário/senha no portal Senior
   
2. **Horários não agendando**
   - Confira formato do SCHEDULES e WEEKDAYS
   - Habilite DEBUG=true para logs detalhados

3. **Problemas de rede**
   - Verifique conectividade com platform.senior.com.br
   - Teste acesso manual pelo navegador

## Contribuição 🤝

Contribuições são bem-vindas! Siga estes passos:
1. Fork do repositório
2. Crie um branch com sua feature
3. Envie PR com testes e documentação

## Licença 📄

MIT License - Consulte o arquivo LICENSE para detalhes.

---

**Aviso Legal:** Use este projeto conforme as políticas da sua organização. O desenvolvedor não se responsabiliza por uso indevido.
