# LUSTIFY V10: Krea 2 Turbo FP8

Профиль `lustify_krea` — подготовленный эксперимент для QuData RTX 3090 24 ГБ,
использующий установленный `stable-diffusion.cpp` и CUDA. Он проверен локальными
автотестами с имитацией бэкенда; настоящий запуск и качество на GPU ещё не проверены.
Запуск может потребовать CPU offload и занять больше времени, а ошибка нехватки
памяти возможна. V9 и Qwen можно вернуть. Генерация пока только по тексту:
редактирование исходной фотографии для Krea 2 требует отдельного адаптера и
ещё не настроено; интерфейс отключит загрузку фото при работающем профиле.

## Что загружается

| Компонент | Источник | Выбранный файл |
| --- | --- | --- |
| Генератор | Civitai LUSTIFY `573152`, V10 `3112728` | Turbo FP8, файл `2997637`, SHA-256 `94d92700fc45200ef053895ec5655d4f64a69b924c1efaa457521dfc22bd5e00` |
| Энкодер | `Comfy-Org/Krea-2` | `text_encoders/qwen3vl_4b_fp8_scaled.safetensors` |
| VAE | `Comfy-Org/Wan_2.1_ComfyUI_repackaged` | `split_files/vae/wan_2.1_vae.safetensors` |

Выбран Turbo FP8, который однозначно определён по карточке и API. Сценарий
автора использует другой вариант — Turbo int8 convrot; его формат поддерживается
движком, но для него пока не установлено соответствие ID файла. Веса вместе
занимают приблизительно 17,1 ГиБ. Энкодер и VAE закреплены проверенными
пользователем revision и SHA-256 Hugging Face. Лицензии генератора, энкодера,
VAE и условия коммерческого использования необходимо изучить до запуска платного
сервиса. Качество и совместимость именно этого набора ещё не подтверждены.

Файлы располагаются в `models/lustify-krea` и не перезаписывают V9 и Qwen.
Постоянный диск в контейнере пока не обнаружен: сохранность файлов после
остановки/удаления аренды нужно уточнять у провайдера. Не удаляйте контейнер,
пока не сохранены нужные результаты, веса и `.env`.

## 1. Обновить проект и сформировать план

В отдельном SSH-терминале на сервере (V9 можно пока не останавливать):

```bash
cd /opt/photo-service
git status --short
git pull --ff-only origin main
.venv/bin/python -m photo_service.download_krea --plan
```

Скрипт проверит metadata модели и напечатает закреплённые компоненты. При ошибке
Git о локальных правках не сбрасывайте их: сначала сохраните и разберите. При
ошибке Civitai 401 скрипт может запросить токен скрытым вводом; при 403 нужно
разобрать доступ. Токен или подписанный адрес загрузки не присылайте в чат.

## 2. Загрузить и проверить веса

```bash
cd /opt/photo-service
.venv/bin/python -m photo_service.download_krea
.venv/bin/python -m photo_service.download_krea --verify
```

Загрузчик проверит место, формат и контрольные суммы. Прерванную загрузку можно
повторить той же командой. Полная проверка SHA-256 может занять несколько минут.
При ошибке не удаляйте прежние веса; пришлите текст ошибки без токена.

## 3. Запустить

Дождитесь завершения заданий, затем остановите старый воркер и старый API через
Ctrl+C в их терминалах. В одном терминале запустите обновлённый API:

```bash
cd /opt/photo-service
.venv/bin/uvicorn photo_service.api:create_app --factory \
  --host 127.0.0.1 --port 8000 --no-access-log
```

В другом:

```bash
cd /opt/photo-service
export LD_LIBRARY_PATH="/opt/photo-toolchain/cuda-12.8.1/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export QWEN_SERVER_BINARY=/opt/photo-toolchain/stable-diffusion.cpp/build-photo/bin/sd-server
export KREA_MODEL_DIR=/opt/photo-service/models/lustify-krea
ENGINE=lustify_krea .venv/bin/python -m photo_service.worker
```

Подождите `Engine ready: lustify_krea`. Загрузка может быть долгой; ошибка
означает, что требуется диагностика, а не подтверждение совместимости.

## 4. Проверить генерацию

В третьем SSH-терминале:

```bash
cd /opt/photo-service
.venv/bin/python scripts/smoke.py --expect-engine lustify_krea \
  --width 1024 --height 1024 --timeout 1800 --output /tmp/lustify-krea.png
```

`PASS` проверяет формат и размер, а не качество; изображение нужно открыть и
оценить. Для Turbo используется стартовый профиль Krea 2: 8 шагов, CFG 1,
Euler. В браузере выберите 1024 × 1024. Не ожидайте идентичной композиции в
результате запуска другой модели с тем же seed.

## Возврат на V9

Остановите Krea-воркер через Ctrl+C. В том же терминале, сохранив экспортированные
переменные `LD_LIBRARY_PATH` и `QWEN_SERVER_BINARY`, выполните:

```bash
cd /opt/photo-service
export LUSTIFY_MODEL_DIR=/opt/photo-service/models/lustify
ENGINE=lustify .venv/bin/python -m photo_service.worker
```

Дождитесь `Engine ready: lustify`. Запускайте по одному GPU-воркеру на порт.
