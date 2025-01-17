#!/bin/bash
# 20250117
# FREDZHANG
# add to systemctl service

main(){
    # 安装依赖
    npm i
    echo "Creating service file..."
    local SERVICE_NAME="swagger-codegen-server.service"
    # 根据端口号，netstat，杀死进程
    local PORT=8787
    local PID=$(netstat -nlp | grep $PORT | awk '{print $7}' | awk -F"/" '{ print $1 }')
    if [ -n "$PID" ]; then
        echo "Killing process $PID..."
        systemctl stop $SERVICE_NAME
        kill -9 $PID
    fi
    local THIS_DIR=$(cd $(dirname $0); pwd)
    echo "[Unit]
Description=Swagger Codegen Server for generating code from Swagger API
After=network.target

[Service]
WorkingDirectory=$THIS_DIR
ExecStart=npm run start
KillMode=process
Type=notify

[Install]
WantedBy=multi-user.target
Alias=swagger-codegen-server.service
" > /etc/systemd/system/$SERVICE_NAME
    # 重新加载 systemd 配置
    echo "Reloading systemd daemon..."
    systemctl daemon-reload

    # 启用并启动服务
    echo "Enabling and starting the service..."
    systemctl enable $SERVICE_NAME
    systemctl restart $SERVICE_NAME
    # 检查服务状态
    systemctl status $SERVICE_NAME
}

main