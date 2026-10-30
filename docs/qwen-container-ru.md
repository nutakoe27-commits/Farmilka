# Qwen на арендованном GPU-контейнере без Docker внутри

Профиль: QuData, Ubuntu 26.04, RTX 3090 24 GB, процессор x86-64;
CUDA-драйвер NVIDIA 575.64.03 обнаружен командой `nvidia-smi`.
Контейнер и его каталоги могут быть временными: проверьте у провайдера,
какой путь сохраняется после остановки. Примеры используют `/opt` внутри
контейнера, а файлы весов — `/opt/photo-service/models`.

**Статус:** на RTX 3090 пройдены оба GPU smoke-теста 512×512; изображения
чайника оценены визуально. Выполняйте по шагам,
останавливайтесь на первой ошибке и присылайте её в чат. Команды на сервере,
если не отмечено иначе. Не копируйте содержимое `.env` или приватные ключи.

## 1. Исходники и системные инструменты

Для нового каталога:

```bash
git clone --branch main --single-branch \
  https://github.com/nutakoe27-commits/Farmilka.git /opt/photo-service
cd /opt/photo-service
```

Если каталог уже существует, сохраните локальные изменения и проверьте
`git status --short --branch`, затем `git pull --ff-only origin main`.

```bash
apt-get update
apt-get install -y --no-install-recommends \
  gcc-14 g++-14 make cmake python3-venv xz-utils ca-certificates
```

Нужны `gcc-14` и `g++-14`: CUDA 12.8 несовместима с некоторыми более
новыми версиями системного компилятора. Пакеты берутся из подписанных
репозиториев Ubuntu. Если пакет GCC 14 не найден, сохраните ошибку и
проверьте доступность репозитория `universe` — не менять систему вслепую.
Эти команды не переустанавливают драйвер NVIDIA.

## 2. Python 3.12 и зависимости приложения

Системный Python контейнера — 3.14; проект использует Python 3.12. В корне
клонированного проекта:

```bash
mkdir -p /opt/photo-toolchain
python3 -m venv /opt/photo-toolchain/bootstrap
/opt/photo-toolchain/bootstrap/bin/python -m pip install uv==0.12.23
export UV_CACHE_DIR=/opt/photo-toolchain/uv-cache
export UV_PYTHON_INSTALL_DIR=/opt/photo-toolchain/python
/opt/photo-toolchain/bootstrap/bin/uv python install 3.12
/opt/photo-toolchain/bootstrap/bin/uv sync --frozen --no-dev --extra qwen
.venv/bin/python scripts/init_env.py
```

Команда `init_env.py` не заменяет существующий `.env`; на новой машине она
создаёт локальные ключи и не выводит их. Файл доступа и данные находятся на
стороне пользователя. Зависимости ставятся из `uv.lock`; Python 3.12 и `uv`
находятся в отдельном каталоге. Веса и приложение ещё не запускались.

## 3. CUDA toolkit и GPU-движок

```bash
cd /opt/photo-service
python3 scripts/install_cuda_toolkit.py
sh scripts/build_qwen_native.sh
```

Первый скрипт получает официальные архивы NVIDIA CUDA 12.8.1, проверяет
закреплённые SHA-256 и распаковывает их в `/opt/photo-toolchain/cuda-12.8.1`.
Для совместимости с новыми заголовками glibc в локальной копии применяется
явное исправление шести деклараций математических функций; исходные архивы
проверяются **до** изменения. Системный драйвер NVIDIA не меняется.

Второй скрипт собирает `stable-diffusion.cpp` с закреплённым commit и
submodules, CUDA-архитектура 86 и четыре параллельных процесса. Первая
компиляция может занять много времени. Не удаляйте кэш при повторном запуске.

Проверить наличие CUDA-устройства именно в новом бинарнике:

```bash
export LD_LIBRARY_PATH=/opt/photo-toolchain/cuda-12.8.1/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export QWEN_SERVER_BINARY=/opt/photo-toolchain/stable-diffusion.cpp/build-photo/bin/sd-server
.venv/bin/python -m scripts.qwen_probe
```

Ожидается `CUDA device and Qwen CLI options: PASS`. Она ещё не проверяет
веса модели или фактическую генерацию.

## 4. Весовые файлы

Проверьте, где провайдер сохраняет данные при остановке контейнера. По
умолчанию используется `/opt/photo-service/models/qwen-image-2.1-turbo`.
Чтобы использовать другой постоянный каталог, задайте его абсолютный путь
в **каждой** сессии перед планированием, загрузкой и запуском воркера:

```bash
export QWEN_MODEL_DIR=/opt/photo-service/models/qwen-image-2.1-turbo
.venv/bin/python -m photo_service.download_qwen --plan
```

Сверьте названия и размеры: denoiser AtomicChat AD-Q4_K, энкодер AtomicChat
Uncensored AD-Q4_K, его F16 vision-проектор и VAE Qwen Image 2.1. Публичный
Hugging Face является источником по умолчанию. После успешного плана:

```bash
.venv/bin/python -m photo_service.download_qwen
.venv/bin/python -m photo_service.download_qwen --verify
```

Загрузчик закрепляет SHA ревизий, проверяет место, формат и SHA-256. Он не
загружает Python-код модели. План фиксируется до скачивания; после прерывания
повтор использует те же ревизии. Точная доступность весов и VAE на этой
конкретной аренде необходимо проверять при загрузке.

## 5. Запустить приложение и проверить две функции

Для первого запуска используйте два SSH-терминала, чтобы видеть ошибки.
В первом:

```bash
cd /opt/photo-service
.venv/bin/uvicorn photo_service.api:create_app --factory \
  --host 127.0.0.1 --port 8000 --no-access-log
```

Во втором:

```bash
cd /opt/photo-service
export LD_LIBRARY_PATH=/opt/photo-toolchain/cuda-12.8.1/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export QWEN_SERVER_BINARY=/opt/photo-toolchain/stable-diffusion.cpp/build-photo/bin/sd-server
export QWEN_MODEL_DIR=/opt/photo-service/models/qwen-image-2.1-turbo
ENGINE=qwen_gguf .venv/bin/python -m photo_service.worker
```

Если весовые файлы находятся в другом месте, задайте их каталог повторно.
Ожидайте `Engine ready: qwen_gguf`: загрузка может быть долгой.

В третьем терминале на сервере:

```bash
cd /opt/photo-service
.venv/bin/python scripts/smoke.py --expect-engine qwen_gguf \
  --timeout 1800 --output /tmp/qwen-first.png
.venv/bin/python scripts/smoke.py --expect-engine qwen_gguf \
  --timeout 1800 --reference /tmp/qwen-first.png --output /tmp/qwen-edited.png
```

Оба результата нужно открыть и оценить визуально. Профиль предназначен для
закрытого пилота; внешний доступ организуем через личный SSH-туннель после
проверки конкретного адреса и порта новой аренды. Команды в открытых терминалах
нужно перезапускать после остановки контейнера.
