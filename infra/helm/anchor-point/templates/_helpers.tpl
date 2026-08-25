{{/*
=============================================================================
_helpers.tpl — Named template library for the anchor-point Helm chart
=============================================================================
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "anchor-point.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully-qualified app name.
Truncated to 63 chars because some Kubernetes name fields have that limit.
If fullnameOverride is set it is used verbatim (still truncated).
*/}}
{{- define "anchor-point.fullname" -}}
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
Chart label — chart name + version with any "+" replaced by "_" so it is a
valid label value.
*/}}
{{- define "anchor-point.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "anchor-point.labels" -}}
helm.sh/chart: {{ include "anchor-point.chart" . }}
{{ include "anchor-point.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels — used in matchLabels and Service selectors.
Keep this minimal and stable; changing it requires a full re-deploy.
*/}}
{{- define "anchor-point.selectorLabels" -}}
app.kubernetes.io/name: {{ include "anchor-point.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service-account name.
*/}}
{{- define "anchor-point.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "anchor-point.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the Secret that holds sensitive environment variables.
If values.secrets.existingSecret is set, that name is used directly.
Otherwise the chart-managed secret (<fullname>-secrets) is assumed.
*/}}
{{- define "anchor-point.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "anchor-point.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Name of the ConfigMap that holds non-sensitive environment variables.
*/}}
{{- define "anchor-point.configMapName" -}}
{{- printf "%s-config" (include "anchor-point.fullname" .) }}
{{- end }}

{{/*
Container image reference — repository:tag.
*/}}
{{- define "anchor-point.image" -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | default .Chart.AppVersion) }}
{{- end }}
