# Подготовка LUSTIFY SDXL на контейнере QuData

## Статус

Профиль подготовлен для **полного SDXL checkpoint в формате safetensors**.
Реальные веса и генерация LUSTIFY на GPU пока не проверены. Выбранная страница
`https://civitai.com/models/2503119/lustify-workflows-krea-2-sdxl` по названию
может описывать workflows для разных моделей; её состав и связь с checkpoint
нужно проверить по API или карточке. Отдельный кандидат `573152` упоминался как
LUSTIFY checkpoint во внешнем источнике, но это не подтверждает, что он тот же
вариант, который выбран пользователем. Загрузчик рассчитан именно на `573152`
и отказывается от неподходящего типа и не-SDXL версий. Пока связь и версия не
установлены, используйте только `--inspect`, не загружайте веса.

Для платного сервиса проверьте условия выбранной версии, её базовой модели и
провайдера; поля API вроде `allowCommercialUse` сами по себе не заменяют
полный текст условий. Качество и доступность модели не подтверждены.

Пути далее относятся к текущему контейнеру QuData: RTX 3090 24 GB,
`/opt/photo-service`, CUDA toolkit и собранный sd-server из инструкции
[qwen-container-ru.md](qwen-container-ru.md). Qwen уже прошёл текстовый и
img2img тесты и остаётся вариантом возврата. Файлы ниже хранятся в контейнере;
сохранность после остановки или удаления аренды ещё не проверена. Не удаляйте
контейнер, пока не сохранены нужные веса, результаты и `.env`.

## 1. Обновить и осмотреть метаданные

На сервере в отдельном SSH-терминале:

```bash
cd /opt/photo-service
git status --short
git pull --ff-only origin main
.venv/bin/python -m photo_service.download_lustify --inspect
```

Если Git сообщает о локальных изменениях, сохраните их перед обновлением;
не выполняйте принудительный сброс. `--inspect` не скачивает веса. Он выводит
версии, тип, размер, SHA-256 и поля лицензии кандидата. HTTP 403 может означать
ограничение сети или сервиса; HTTP 401 может потребовать токен. Токен не
присылать в чат; при запросе скрипт принимает его скрытым вводом.

## 2. После подтверждения нужного checkpoint

Команды ниже применимы **только если проверено**, что кандидат `573152` и его
обычная SDXL версия соответствуют выбранной модели. Если выбранная карточка
требует Krea 2, LoRA, особый workflow или иную архитектуру, этот профиль не
представляет собой готовое решение; требуется отдельная адаптация.

Сначала сформировать план, проверить версию, размер, хеш и права:

```bash
cd /opt/photo-service
export LUSTIFY_MODEL_DIR=/opt/photo-service/models/lustify
.venv/bin/python -m photo_service.download_lustify --plan
```

При необходимости явно выбрать проверенную обычную SDXL версию через
`--plan --version-id ЧИСЛО`; если у неё несколько файлов, указать также
`--file-id ЧИСЛО`. Загрузчик сохраняет план и использует его при повторном
запуске. `--refresh` меняет выбранную версию и требует новой проверки.

После проверки плана скачать и проверить:

```bash
.venv/bin/python -m photo_service.download_lustify
.venv/bin/python -m photo_service.download_lustify --verify
```

Скачивание может потребовать авторизацию Civitai. На 401 скрипт спросит токен
без отображения и без записи в файл. Токен можно также задать в переменной
`CIVITAI_TOKEN` на сервере, не добавляя его в команды, файлы и чат. Скрипт
проверяет SHA-256 из API, формат файла и свободное место. Загрузка возобновляется
после обрыва; до успешной проверки старый bundle не заменяется.

## 3. Переключить сервис

Дождитесь завершения заданий. Остановите запущенные Qwen-воркер и API с помощью
Ctrl+C в соответствующих SSH-терминалах. В первом терминале запустите обновлённый API:

```bash
cd /opt/photo-service
.venv/bin/uvicorn photo_service.api:create_app --factory \
  --host 127.0.0.1 --port 8000 --no-access-log
```

Во втором терминале:

```bash
cd /opt/photo-service
export LD_LIBRARY_PATH="/opt/photo-toolchain/cuda-12.8.1/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export QWEN_SERVER_BINARY=/opt/photo-toolchain/stable-diffusion.cpp/build-photo/bin/sd-server
export LUSTIFY_MODEL_DIR=/opt/photo-service/models/lustify
ENGINE=lustify .venv/bin/python -m photo_service.worker
```

Ожидается `Engine ready: lustify`. Ошибку запуска пришлите в чат без ключей и
токенов. До реального запуска нельзя утверждать, что этот checkpoint совместим
с собранным бэкендом или помещается в память. SDXL использует стартовые настройки
25 шагов, CFG 5 и Euler a; после просмотра карточки модели и тестов их можно
уточнить. Фотографии при img2img могут менять композицию: опишите желаемое
итоговое изображение, исходник будет обрезан по формату и масштабирован.

## 4. Проверить генерацию

В третьем SSH-терминале на сервере:

```bash
cd /opt/photo-service
.venv/bin/python scripts/smoke.py --expect-engine lustify \
  --timeout 1800 --output /tmp/lustify-first.png
.venv/bin/python scripts/smoke.py --expect-engine lustify \
  --timeout 1800 --reference /tmp/lustify-first.png --output /tmp/lustify-edited.png
```

`PASS` означает корректный ответ нужного размера, но качество и следование
промпту проверяются просмотром изображений. Начните с 512×512, затем при
успехе проверьте 1024×1024 через `--width 1024 --height 1024`. Для этого
профиля размеры должны делиться на 64; варианты в интерфейсе подходят.

Если необходимо вернуться к Qwen, остановите LUSTIFY-воркер через Ctrl+C и в
том же терминале выполните:

```bash
export QWEN_MODEL_DIR=/opt/photo-service/models/qwen-image-2.1-turbo
ENGINE=qwen_gguf .venv/bin/python -m photo_service.worker
```

Оставьте прежние переменные `LD_LIBRARY_PATH` и `QWEN_SERVER_BINARY`. Запускайте
только один GPU-воркер на одном порту. Код и файлы Qwen не удаляются.
