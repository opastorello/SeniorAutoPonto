# SeniorAutoPonto 🕒

Automatize a marcação de ponto na **plataforma Senior** com segurança, flexibilidade e inteligência.
O sistema executa marcações automáticas com variação aleatória, respeitando dias úteis, modo férias e notificações via Webhook — tudo configurável via `.env` ou Docker.

---

## ⚡ Principais Recursos

* 🕗 **Marcação automática de ponto** com autenticação real na plataforma Senior
* 🧭 **Agendamento inteligente** (baseado em horários e dias da semana)
* 🎲 **Variação temporal aleatória** (offset positivo ou negativo)
* 🏖️ **Modo férias** — pausa automática entre `VACATION_START` e `VACATION_END`
* 🔁 **Reexecução automática** em caso de falha ou erro de rede
* 📡 **Webhook opcional** para enviar notificações de sucesso ou erro
* 🧱 **Logs detalhados** com níveis de informação e depuração
* ⚙️ **Configuração simples via .env** e suporte total a Docker

---

## 🚀 Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/opastorello/SeniorAutoPonto.git
cd SeniorAutoPonto
```

### 2. Crie o arquivo `.env`

```bash
cp .env.example .env
```

### 3. Configure suas credenciais e horários

```env
USER=seu.usuario@empresa.com
PASSWORD=suaSenhaSegura123
SCHEDULES=08:00,12:00,13:00,17:30
WEEKDAYS=1-5
TZ=America/Sao_Paulo
```

---

## ⚙️ Configuração das Variáveis

| Variável         | Descrição                                                           |
| ---------------- | ------------------------------------------------------------------- |
| `USER`           | E-mail de login na plataforma Senior                                |
| `PASSWORD`       | Senha do usuário Senior                                             |
| `SCHEDULES`      | Horários de marcação (ex: `"08:00,12:00,13:00,17:30"`)              |
| `WEEKDAYS`       | Dias da semana (`0=Dom`, `1=Seg` ... ex: `"1-5"` = segunda a sexta) |
| `TZ`             | Fuso horário (padrão: `America/Sao_Paulo`)                          |
| `RANDOM_OFFSET`  | Variação máxima em segundos (padrão: `300` = ±5min)                 |
| `VACATION_START` | Data de início das férias (formato: `YYYY-MM-DD`, opcional)         |
| `VACATION_END`   | Data de término das férias (formato: `YYYY-MM-DD`, opcional)        |
| `WEBHOOK_URL`    | URL para envio de logs (opcional)                                   |
| `DEBUG`          | Ativa logs detalhados (`true`/`false`)                              |
| `MAX_RETRIES`    | Máximo de tentativas de marcação (padrão: `3`)                      |

---

## 🐳 Execução com Docker

Crie e inicie o contêiner:

```bash
docker build -t senior-auto-ponto .
docker run --restart always -d --name senior-auto-ponto --env-file .env senior-auto-ponto
```

Verifique os logs em tempo real:

```bash
docker logs -f senior-auto-ponto
```

Exemplo de saída:

```
[INFO] 2025-02-03 08:57:32 Executando marcação (offset: -148s)
[INFO] 2025-02-03 08:57:33 Ponto registrado com sucesso
```

---

## 🔔 Notificações via Webhook

Se configurado, o sistema envia JSONs com o status da marcação para seu Webhook (Discord, Slack, MS Teams etc.).

**Exemplo de sucesso:**

```json
{
  "status": "success",
  "baseTime": "2025-02-02T08:00:00.000Z",
  "executed": "2025-02-02T08:02:32.123Z",
  "offsetSeconds": -148,
  "response": { ... }
}
```

**Exemplo de erro:**

```json
{
  "status": "error",
  "baseTime": "2025-02-02T12:00:00.000Z",
  "error": "Falha na autenticação",
  "offsetSeconds": 122
}
```

---

## 🔒 Segurança

* Nenhuma credencial é salva em disco — apenas via variáveis de ambiente
* Sessões autenticadas gerenciadas via cookies em memória
* Suporte a execução em ambientes isolados (containers)
* Dependências atualizadas regularmente via Docker

---

## 🧠 Solução de Problemas

| Sintoma                    | Causa provável                                   | Solução                                  |
| -------------------------- | ------------------------------------------------ | ---------------------------------------- |
| ❌ “Falha na autenticação”  | Credenciais inválidas                            | Verifique `USER` e `PASSWORD`            |
| ⚙️ “Horários não executam” | Formato incorreto de `SCHEDULES` ou `WEEKDAYS`   | Use `"HH:mm,HH:mm"` e `"1-5"`            |
| 🌐 “Erro de rede”          | Problema de conexão com `platform.senior.com.br` | Teste acesso manual via navegador        |
| 💤 “Sem logs novos”        | Modo férias ativo                                | Revise `VACATION_START` e `VACATION_END` |

Ative o modo detalhado com:

```env
DEBUG=true
```

---

## 🤝 Contribuições

Contribuições são bem-vindas!

1. Faça um fork do projeto
2. Crie um branch com sua feature (`git checkout -b feature/nova-funcionalidade`)
3. Envie um Pull Request com descrição e testes

---

## 📄 Licença

Distribuído sob a **MIT License**.
Consulte o arquivo `LICENSE` para mais detalhes.

---

> ⚠️ **Aviso Legal:**
> Este projeto destina-se a fins educacionais e de automação pessoal.
> O uso em ambientes corporativos deve respeitar as políticas internas da sua empresa.
> O autor não se responsabiliza por uso indevido ou não autorizado.
