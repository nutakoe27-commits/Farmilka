# Переезд на Heartsync LoRA для FLUX.1-dev

Активная инструкция перехода теперь в [qwen-ru.md](qwen-ru.md): пользователь
выбрал Qwen. Эта инструкция оставлена для дополнительного режима `flux_lora`;
его загрузка и развёртывание на GPU не выполнялись.

Это отдельный, пока не проверенный на настоящих весах режим `flux_lora`.
Рабочий Klein остаётся режимом `flux` и образом `photo-worker:local`.
Все изменения исходников делаются в `main`. На GPU VM каталог `/opt/photo-service`.

## Что опубликовано у Heartsync

По предоставленному пользователем ответу Hugging Face API:

- Репозиторий: `Heartsync/Flux-NSFW-uncensored`, доступ к LoRA публичный.
- Ревизия: `328160f16bc4072cf2bb7ee162d77f3b9b5f786c`.
- Файл: `lora.safetensors`, 687476088 байт.
- Это адаптер для `black-forest-labs/FLUX.1-dev`, а не самостоятельная модель.
- В карточке адаптера указано `creativeml-openrail-m`.

Базовая FLUX.1-dev использует отдельную **Non-Commercial License**. Метка
лицензии LoRA не заменяет права на базовую модель. Для коммерческого или
production-сервиса необходимо подходящее разрешение BFL и выполнение его условий.
Этот вариант подготовлен для закрытого тестирования; коммерческая отчётность
по лицензии BFL в коде не реализована.

Источники:

- <https://huggingface.co/Heartsync/Flux-NSFW-uncensored>
- <https://huggingface.co/black-forest-labs/FLUX.1-dev>
- <https://github.com/black-forest-labs/flux/blob/main/model_licenses/LICENSE-FLUX1-dev>
- <https://bfl.ai/pricing/licensing>
- <https://huggingface.co/docs/diffusers/quantization/bitsandbytes>

Название адаптера не является подтверждением качества или выполнения любого промпта.

## Отличия от Klein

Используются `FluxPipeline` и `FluxImg2ImgPipeline`, 28 шагов, guidance 3.5,
NF4-квантизация трансформера и T5, CPU offload. Веса загружаются локально,
LoRA применяется через PEFT; слияние LoRA с квантизованными весами не выполняется.
Ожидаемое потребление памяти и скорость предстоит измерить на RTX 3090 Ti.

Фото + текст здесь означает **img2img с силой изменения 0.65**. Описывайте
желаемый результат целиком, например «синий керамический чайник на деревянном
столе у окна». Точное редактирование отдельных деталей, показанное Klein,
не подтверждено для этого режима. Подсказка в интерфейсе меняется при загрузке фото.

## 1. Проверьте доступ и место

В своём аккаунте Hugging Face откройте карточку **FLUX.1-dev** и проверьте
условия доступа. Примите условия, если они подходят вашей задаче. При необходимости
создайте read-only токен в <https://huggingface.co/settings/tokens> с доступом
к этой gated-модели. Само наличие токена не заменяет разрешение аккаунта.

На сервере:

```bash
cd /opt/photo-service
df -h /opt/photo-service
git status --short
git pull --ff-only origin main
docker image inspect photo-worker:local --format '{{.Id}}'
```

Для базы потребуется существенно больше места, чем 687 МБ: скачиваются
трансформер, T5, CLIP и VAE. Оставьте ориентировочно 45 GiB свободного места
для новой загрузки с запасом. Скрипт дополнительно проверяет свободное место
по размерам файлов из API. Исходный монолитный checkpoint параллельно с
Diffusers-компонентами не скачивается. Klein и пользовательские данные сохраняются.

Если `git status` показал изменения исходников, сохраните их до обновления;
не применяйте reset или force. `.env` и модели игнорируются Git.

## 2. Соберите дополнительные зависимости

Текущий Klein может продолжать работать во время подготовки.

```bash
cd /opt/photo-service
docker compose build api
docker build --progress=plain \
  --output type=docker,compression=uncompressed \
  -f Dockerfile.flux-lora -t photo-worker-flux-lora:local .
```

`Dockerfile.flux-lora` расширяет существующий локальный `photo-worker:local`.
Старый образ сохраняется. Версии уже установленных зависимостей не меняются;
добавляются bitsandbytes, PEFT, SentencePiece и protobuf. Кэш установки новых
пакетов в дополнительном слое не сохраняется. Для этого пути нужен уже
построенный базовый GPU-образ и штатный Docker builder с доступом к нему.

Проверьте настоящий NF4 + LoRA CUDA-кернел на небольшой тестовой матрице:

```bash
docker compose -f compose.yaml -f compose.flux-lora.yaml --profile gpu \
  run --rm --no-deps gpu-worker python scripts/lora_probe.py
```

Ожидается `NF4 + LoRA CUDA operation: PASS`. Это проверка зависимостей,
а не загрузка или оценка качества самой модели Heartsync.

## 3. Загрузите базу и адаптер

```bash
python3 scripts/download_flux_lora.py
```

Скрипт сначала использует существующий `HF_TOKEN` из окружения или проверяет
его наличие в конфигурации контейнера. Если его нет, запросит токен скрытым
вводом в SSH-терминале. Значение не выводится, не помещается в аргументы
команд и не записывается в `.env` или Git. Процесс скачивания получает его
только через временное окружение. Его код завершения сохраняется.

Ожидаются две строки `Model cached`: для FLUX.1-dev и Heartsync. У каждой
модели отдельный каталог и manifest. LoRA закреплена на указанном выше SHA,
база фиксируется на SHA при первом успешном скачивании. Готовый локальный
кэш используется после перезапуска без повторной проверки сети.

При 401/403 проверьте наличие токена, доступ именно его аккаунта к FLUX.1-dev,
разрешения токена и ответ сервиса/прокси. Эти ошибки сами по себе не означают,
что нужно создавать ещё один токен. При прерывании повторите ту же команду:
Hugging Face повторно использует доступные загруженные файлы. TLS и проверка
артефактов остаются включёнными; `.bin`/pickle и удалённый Python-код не нужны.

## 4. Переключите воркер

В закрытом пилоте дождитесь завершения текущих заданий. Затем:

```bash
docker compose --profile gpu stop gpu-worker
docker compose -f compose.yaml -f compose.flux-lora.yaml --profile gpu \
  up -d --no-build api gpu-worker
docker compose -f compose.yaml -f compose.flux-lora.yaml --profile gpu \
  logs --tail 100 -f api gpu-worker
```

Обновление API требуется: он должен распознавать новый тип воркера.
Дождитесь `Engine ready: flux_lora`. Ctrl+C закрывает только просмотр логов.
Один воркер обслуживает очередь; старый и новый одновременно не запускаются.

## 5. Проверьте оба сценария на 512×512

```bash
docker compose exec -T api python scripts/smoke.py \
  --expect-engine flux_lora --timeout 1200 --output /tmp/heartsync-text.png
docker compose exec -T api python scripts/smoke.py \
  --expect-engine flux_lora --timeout 1200 \
  --reference /tmp/heartsync-text.png --output /tmp/heartsync-edit.png
```

Ожидается `PASS engine=flux_lora` с `reference=False` и `reference=True`.
После этого посмотрите изображения и сравните результат с промптами.
Вывод PASS подтверждает получение PNG, но не качество или тип содержимого.
Скорость Klein 32.5 секунды на другом запросе не является прогнозом этой модели.

Скопировать результаты на VM:

```bash
docker compose cp api:/tmp/heartsync-text.png /tmp/heartsync-text.png
docker compose cp api:/tmp/heartsync-edit.png /tmp/heartsync-edit.png
```

Далее скачайте их на Mac по уже настроенному SSH/SCP. Обновите вкладку
веб-интерфейса через существующий SSH-туннель и проверьте свой обычный запрос.

## 6. Возврат к проверенному Klein

```bash
docker compose -f compose.yaml -f compose.flux-lora.yaml --profile gpu stop gpu-worker
docker compose --profile gpu up -d --no-build api gpu-worker
docker compose logs --tail 80 -f gpu-worker
```

Дождитесь `Engine ready: flux`, затем выполните прежний smoke с
`--expect-engine flux`. Возврат использует старый образ и прежние веса.
База FLUX.1 и LoRA остаются в отдельных каталогах общего тома.

## Настройки после первых тестов

В `.env` можно задать `LORA_SCALE=1.0`, `FLUX1_STEPS=28`,
`FLUX1_GUIDANCE=3.5`, `FLUX1_IMG2IMG_STRENGTH=0.65`. Применение:

```bash
docker compose -f compose.yaml -f compose.flux-lora.yaml --profile gpu \
  up -d --no-build gpu-worker
```

Начните с 512×512 и одного запроса. При нехватке памяти проверьте отсутствие
второго модельного процесса и сохранение CPU offload. 768/1024, скорость,
языки и качество проверяются отдельно после успешного базового теста.
