#/bin/bash
# add to systemctl service

main () {
  local service_content="[Unit]
  Description=Swagger Codegen Server
  After=network.target

  [Service]
  Type=simple
  WorkingDirectory=/root/swagger-codegen-server
  ExecStart=npm install && npm start
  Restart=on-failure
  "
  echo "$service_content" > /etc/systemd/system/swagger-codegen-server.service
  systemctl daemon-reload
  systemctl enable swagger-codegen-server
  systemctl restart swagger-codegen-server
  systemctl status swagger-codegen-server
}

main