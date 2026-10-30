# Переход на Qwen Image 2.1 Turbo с энкодером AtomicChat

Целевая машина: QuData, Docker Ubuntu 24.04, RTX 3090 Ti 24 GB,
56 GiB RAM; проект `/opt/photo-service`, ветка `main`.
Все команды ниже выполняются **на GPU-сервере по SSH**, кроме явно отмеченного Mac.

## Если аренда создана заново

При новой аренде сначала проверьте, вернулся ли прежний диск. Остановка и
удаление VM могут по-разному влиять на сохранность данных у провайдера;
наличие старого `/opt/photo-service`, `.env`, Docker-образов и volume нужно
проверить на самой машине. Старые адрес и порт SSH могут измениться.
Код проекта сохранён в GitHub `main`, но Git не содержит ключи, результаты и веса.

Для первого теста выбирайте одну RTX 3090 / 3090 Ti с 24 GB VRAM,
Docker Ubuntu 24.04, от 32 GB RAM (предпочтительно 64 GB) и диск около 150 GB.
Фактическое потребление памяти выбранной моделью ещё предстоит измерить.
При выборе другой видеокарты нужно изменить CUDA_ARCHITECTURES перед сборкой;
текущий профиль `86` рассчитан на 3090 / 3090 Ti. Прикрепите существующий
публичный SSH-ключ `photo-gpu`; приватный `~/.ssh/qudata_photo` остаётся на Mac.

После подключения по **новым** данным SSH проверить:

```bash
nvidia-smi
docker info --format 'Docker Server: {{.ServerVersion}}'
docker compose version
free -h
df -h /
```

Если это чистая VM и каталога проекта ещё нет:

```bash
git clone --branch main --single-branch \
  https://github.com/nutakoe27-commits/Farmilka.git /opt/photo-service
cd /opt/photo-service
python3 scripts/init_env.py
python3 scripts/inspect_qwen.py
```

`git` и `python3` должны быть установлены. При необходимости в шаблоне Ubuntu
под root: `apt-get update`, затем `apt-get install -y git python3 ca-certificates`.
Для закрытого GitHub-репозитория потребуется доступ аккаунта на VM или перенос
архива проекта; ошибку доступа разбираем отдельно, секреты в чат не передаём.
Если каталог уже существует, используйте шаг 1 ниже, сохранив существующий `.env`.
Новые ключи API, созданные `init_env.py` на чистой VM, отличаются от прежних;
в браузер позже понадобится вставить новый API-ключ.

На чистой VM также отсутствует образ `photo-worker:local`, на котором основан
Qwen-образ. После успешной проверки metadata, перед шагом 2, собрать эту базу:

```bash
cd /opt/photo-service
docker build --progress=plain \
  --output type=docker,compression=uncompressed \
  -f Dockerfile.gpu -t photo-worker:local .
docker run --rm --gpus all photo-worker:local python scripts/gpu_probe.py
```

Это установка Python/CUDA-зависимостей, **без загрузки модели Klein**.
Команда probe заменяет обычный запуск контейнера. После `CUDA bfloat16 matrix
operation: PASS` перейти к шагу 2: собрать API и отдельный образ Qwen.
Затем probe Qwen, загрузка четырёх компонентов и запуск по шагам 3–6.
Не нужно предварительно запускать FLUX или получать доступ к FLUX.1-dev.

## Что именно подключаем

Карточка выбранного пользователем
[AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF](https://huggingface.co/AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF)
описывает **текстовый энкодер Qwen3-VL-8B с изменёнными весами**. Он занимает
место `--llm`, а не `--diffusion-model`. Для генерации используются четыре файла:

| Компонент | Репозиторий | Файл по умолчанию |
| --- | --- | --- |
| Генератор (denoiser) | `AtomicChat/Qwen-Image-2.1-Turbo-GGUF` | `Qwen-Image-2.1-Turbo-AD-Q4_K.gguf` |
| Выбранный энкодер | `AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF` | `Qwen-Image-2.1-Turbo-Uncensored-AD-Q4_K.gguf` |
| Vision-проектор для редактирования | тот же репозиторий энкодера | `mmproj-Qwen-Image-2.1-Turbo-Uncensored-F16.gguf` |
| VAE именно версии 2.1 | `Comfy-Org/Qwen-Image-2.1` | `vae/qwen_image_2.1_vae_bf16.safetensors` |

Это рекомендуемый автором вариант AD-Q4_K, а не обычный Q4_K_M. Согласно
карточке, энкодер занимает около 5.29 GB, vision-проектор — около 1.16 GB;
сюда нужно прибавить генератор, VAE, рабочие буферы и место для сборки CUDA.
Точные размеры и SHA берутся из API перед загрузкой. Мы не скачиваем все
квантизации, исходные BF16-веса и новую базу FLUX.1. Доступ к FLUX.1-dev и его
токен для этого перехода больше не нужны.

Карточка автора сообщает, что в его наборе из 45 запросов замена энкодера
не изменила число успешно изображённых сцен. Название Uncensored не означает,
что генератор научился изображать всё. Здесь не выполняется чат с энкодером:
он формирует представление текста и исходного фото для генератора.

Энкодер помечен Apache 2.0. Генератор Qwen Image 2.1 Turbo использует отдельную
[Qwen Research License](https://github.com/QwenLM/Qwen-Image-2.1/blob/main/LICENSE),
которая предусматривает отдельную коммерческую лицензию. Метка энкодера не
заменяет права на генератор; это нужно учесть до коммерческого запуска сервиса.

## 1. Обновить код и проверить реальные файлы

Сначала убедитесь, что нет локальных правок, и проверьте место:

```bash
cd /opt/photo-service
git status --short
df -h /opt/photo-service
```

Если `git status` показывает изменения исходников, сохраните их и разберите
перед обновлением; не используйте `reset --hard` или принудительную перезапись.
Сгенерированный `.env` должен оставаться игнорируемым Git.

```bash
git pull --ff-only origin main
python3 scripts/inspect_qwen.py
```

Скрипт использует только стандартную библиотеку Python: сборка, GPU, токен и
скачивание весов не нужны. Он печатает открытые metadata двух репозиториев,
revision, названия файлов и размеры. README энкодера уже предоставлен пользователем;
при необходимости получить README обоих репозиториев добавьте `--readme`.
Проверьте наличие файлов из таблицы и доступность самих репозиториев.
Если возникла ошибка API, пришлите её в чат и остановитесь на этом шаге.

По умолчанию используются ссылки Hugging Face из карточки автора. Исходная
страница PirateFace является другим endpoint; для проверки **тех же репозиториев**:

```bash
python3 scripts/inspect_qwen.py --source pirateface
```

Автоматического перехода на другую модель нет. PirateFace должен поддерживать
совместимый Hub API и загрузку по SHA; наличие HTML-страницы этого не доказывает.
Скрипты обращаются анонимно и не передают `HF_TOKEN` на PirateFace. Если требуется
авторизация или выдаётся 401/403/404, сначала выясним причину; пароль или токен
в чат не отправляйте. Из CPU-среды Codex оба сайта пока блокирует сетевой прокси,
поэтому их фактический API и SHA этой модели должны быть проверены здесь.

## 2. Собрать отдельный образ Qwen

Если сохранён прежний диск, текущий воркер Klein пока может продолжать работать.
Проверьте наличие базового образа; для чистой VM он собирается по разделу выше:

```bash
docker image inspect photo-worker:local --format '{{.Id}}'
```

Не удаляйте его, volume `photo-models` или веса Klein. Новый образ имеет другое
имя `photo-worker-qwen:local`, но использует прежние CUDA/Python-слои. Рекомендуем
иметь хотя бы 35 GiB свободно до сборки; точный объём весов проверит загрузчик.

```bash
docker compose build api
docker build --progress=plain \
  --output type=docker,compression=uncompressed \
  -f Dockerfile.qwen-gguf -t photo-worker-qwen:local .
```

Собирается закреплённый `stable-diffusion.cpp`
`e239e4b0fd3de49834cec67031a44796ca465abc`, включая закреплённые submodules.
CUDA toolkit 12.8.1 закреплён digest. Только архитектура `86` (RTX 3090 Ti),
четыре параллельные задачи; Node, встроенный интерфейс и video codecs отключены.
Это первая компиляция C++/CUDA и может занять несколько минут или дольше.
Повторный запуск той же команды использует build cache.

Компиляция использует Ubuntu 22.04, чтобы бинарник работал в Debian 12
старого Python-образа. Общие CUDA runtime/cuBLAS берутся из закреплённых
PyTorch cu128-зависимостей; `sd-server --help` во время сборки проверяет загрузку
бинарника и его библиотек. Это ещё не проверка CUDA-ядер или модели.

`Dockerfile.qwen-gguf` ожидает именно `photo-worker:local`. Если образ имеет
другое имя, сначала уточните его происхождение; на чистой VM используйте сборку выше.

## 3. Проверить доступ к GPU нового бинарника

```bash
sh scripts/qwen.sh run --rm --no-deps gpu-worker python -m scripts.qwen_probe
```

Ожидается имя CUDA-устройства и
`CUDA device and Qwen CLI options: PASS (model generation is not tested)`.
Наличие `nvidia-smi` само по себе не заменяет эту проверку C++-бэкенда.

## 4. План загрузки, затем веса

Сначала получить SHA, пути, лицензии и размеры всех четырёх компонентов:

```bash
sh scripts/qwen.sh run --rm --no-deps gpu-worker \
  python -m photo_service.download_qwen --plan
```

Если всё соответствует таблице, загрузить:

```bash
sh scripts/qwen.sh run --rm --no-deps gpu-worker \
  python -m photo_service.download_qwen
```

Для проверенного PirateFace endpoint добавляйте `--source pirateface` к обеим
командам. VAE в любом случае загружается из указанного официального HF-репозитория.
Все ссылки закрепляются полными commit SHA при разрешении плана. `--plan`
сохраняет `download-plan.json`; загрузка и её повтор после сбоя используют
именно эти ревизии, без незаметного обновления `main` модели. Для изменения
endpoint или перехода на свежие ревизии нужен явный `--refresh`.
Загрузчик проверяет свободное место, размер, формат GGUF/safetensors и SHA256;
при наличии LFS checksum сверяет его с источником. HTML-страница ошибки весами
не считается. Не загружается и не исполняется Python-код из репозиториев модели.

В Docker volume `photo-models` используется отдельный каталог
`/models/qwen-image-2.1-turbo`. Только после успешной проверки всех четырёх
файлов создаётся `bundle.json`. При прерванном скачивании повторите ту же
команду; завершённые данные и кэш могут быть использованы снова. Уже готовый
bundle повторно проверяется offline и не обновляется автоматически.
`--refresh` явно разрешает переход на новые SHA и требует повторной проверки.

Полная повторная проверка без доступа к Hub:

```bash
sh scripts/qwen.sh run --rm --no-deps gpu-worker \
  python -m photo_service.download_qwen --verify
```

Другую квантизацию можно выбрать явно, например
`--text-encoder-file Qwen-Image-2.1-Turbo-Uncensored-Q8_0.gguf` при первом
скачивании или с `--refresh`. Для первого теста оставляем AD-Q4_K; фактические
VRAM, время и качество на вашей GPU пока не измерены.

## 5. Переключить один воркер

Дождитесь завершения предыдущих заданий. Если был запущен демонстрационный
воркер, сначала остановите его. Запускать несколько воркеров с разными моделями
для общей очереди сейчас нельзя: неизвестно, какой из них заберёт запрос.

```bash
docker compose --profile demo stop demo-worker
docker compose --profile gpu stop gpu-worker
sh scripts/qwen.sh up -d --no-build api gpu-worker
sh scripts/qwen.sh logs --tail 100 -f api gpu-worker
```

В интерфейсе и `/healthz` новый режим называется `qwen_gguf`. Ожидаем
`Qwen backend loaded all four pinned components`, затем `Engine ready: qwen_gguf`.
Ctrl+C в просмотре логов не останавливает контейнеры.

`sd-server` — отдельный постоянный процесс внутри worker-контейнера. Он слушает
только loopback контейнера и не имеет публичного порта. Работает через native
API; промпт не превращается в CLI-опции. Веса сохраняются загруженными между
заданиями, CUDA может выгружать параметры в RAM, VAE работает с tiling.
Используется точное Turbo-расписание: 8 шагов, Euler, CFG 1.0. Heartbeat очереди
продолжается во время генерации. По timeout воркер отменяет задание и останавливает
бэкенд, чтобы зависшая генерация не продолжала занимать GPU; следующий запрос
поднимает бэкенд снова. Процесс закрывается и при штатной остановке воркера.

## 6. Проверить оба режима и посмотреть результат

Генерация 512×512:

```bash
docker compose exec -T api python scripts/smoke.py \
  --expect-engine qwen_gguf --timeout 1800 --output /tmp/qwen-first.png
```

Изменить цвет чайника по исходному фото:

```bash
docker compose exec -T api python scripts/smoke.py \
  --expect-engine qwen_gguf --timeout 1800 \
  --reference /tmp/qwen-first.png --output /tmp/qwen-edited.png
```

Ожидаются `PASS engine=qwen_gguf reference=False` и `reference=True`.
Это проверки транспорта, модели, размеров и формата; осмысленность редактирования
нужно проверить визуально. Скорость 32.5 секунды прежнего Klein к Qwen не относится.

```bash
docker compose cp api:/tmp/qwen-first.png /tmp/qwen-first.png
docker compose cp api:/tmp/qwen-edited.png /tmp/qwen-edited.png
nvidia-smi
```

На **Mac**, в новом локальном терминале:

```bash
scp -i "$HOME/.ssh/qudata_photo" -P 10070 \
  root@akke-yw32-a0yw.ru1.qudata.ai:/tmp/qwen-first.png ~/Downloads/
scp -i "$HOME/.ssh/qudata_photo" -P 10070 \
  root@akke-yw32-a0yw.ru1.qudata.ai:/tmp/qwen-edited.png ~/Downloads/
```

После просмотра изображений используйте прежний SSH-туннель и API-ключ в
браузере. Первый тест оставьте на 512×512; затем проверим 768 и 1024,
русский промпт и ваше фото. Интерфейс сохраняет десять языков. Мультиязычное
качество именно выбранной сборки отдельно не проверялось.

## Если модель не загрузилась

Присылайте сообщения об ошибках, не `.env` и не секреты. Бэкенд не выводит
промпты и ключи в обычные логи. Для подробного лога **загрузки весов** временно
остановите worker и запустите его точную команду в foreground:

```bash
sh scripts/qwen.sh stop gpu-worker
sh scripts/qwen.sh run --rm --no-deps gpu-worker python -m scripts.qwen_diagnose
```

Этот режим не принимает задания очереди и не готовит публичный сервер.
При успешной загрузке он остаётся работать; Ctrl+C завершает его, затем:

```bash
sh scripts/qwen.sh up -d --no-build api gpu-worker
```

При нехватке VRAM начните с 512×512 и убедитесь, что старый воркер остановлен.
При ошибке несовместимой модели, неполной загрузке, отсутствии CUDA или ошибке
Shared Library пришлите точное сообщение; не переименовывайте FLUX-веса в GGUF.

## Возврат к проверенному Klein

```bash
sh scripts/qwen.sh stop gpu-worker
docker compose --profile gpu up -d --no-build api gpu-worker
docker compose logs --tail 100 -f gpu-worker
```

Дождитесь `Engine ready: flux` и выполните прежний smoke
`--expect-engine flux`. Обновлённый API принимает оба типа воркеров.
На чистой VM без весов Klein такой запуск сначала скачает эту модель;
мгновенный возврат возможен только при сохранённом кэше. Для установки Qwen
на новой VM скачивать Klein заранее не требуется.
Переключение режима не удаляет данные и веса из volume. Не используйте `down -v`,
`docker system prune`, удаление аренды или force push для этой миграции.

## Что действительно проверено в Codex

См. `validation.md`. CPU-тесты, сборка C++ без CUDA и запуск native API
проверяются здесь. CUDA-сборка контейнера, доступность фактических весов,
загрузка AtomicChat-компонентов, обе настоящие генерации, VRAM и скорость
должны пройти на QuData; до этого переезд не считается завершённым.

Официальные источники: [Qwen Image 2.1](https://github.com/QwenLM/Qwen-Image-2.1),
[Qwen 2.1 в stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp/blob/e239e4b0fd3de49834cec67031a44796ca465abc/docs/qwen_image_2.1.md),
[native API](https://github.com/leejet/stable-diffusion.cpp/blob/e239e4b0fd3de49834cec67031a44796ca465abc/examples/server/api.md).
