{{/*
Expand the name of the chart.
*/}}
{{- define "config-service.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "config-service.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "config-service.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{ include "config-service.selectorLabels" . }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "config-service.selectorLabels" -}}
app.kubernetes.io/name: {{ include "config-service.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ConfigMap name for config files
*/}}
{{- define "config-service.configmap.configs" -}}
{{ include "config-service.fullname" . }}-configs
{{- end }}

{{/*
ConfigMap name for schema files
*/}}
{{- define "config-service.configmap.schemas" -}}
{{ include "config-service.fullname" . }}-schemas
{{- end }}

{{/*
Secret name
*/}}
{{- define "config-service.secret" -}}
{{ include "config-service.fullname" . }}
{{- end }}
