#!/bin/sh
set -eu

runtime_data_dir="${DATA_DIR:-/var/data}"
seed_dir="/app/seed-data"

mkdir -p "${runtime_data_dir}"

if [ ! -f "${runtime_data_dir}/.seed-initialized" ]; then
  if [ -f "${seed_dir}/douyinlm.db" ]; then
    cp "${seed_dir}/douyinlm.db" "${runtime_data_dir}/douyinlm.db"
  fi
  if [ -d "${seed_dir}/keyframes" ]; then
    cp -R "${seed_dir}/keyframes" "${runtime_data_dir}/keyframes"
  fi
  touch "${runtime_data_dir}/.seed-initialized"
fi

for directory in incoming originals proxies audio keyframes cache; do
  mkdir -p "${runtime_data_dir}/${directory}"
done

export APP_PORT="${PORT:-10000}"

exec python -m douyinlm
