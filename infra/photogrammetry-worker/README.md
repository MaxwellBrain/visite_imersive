# Worker GPU de photogrammétrie

Reconstruit les campagnes de prises de vue en modèles 3D texturés, puis s'éteint
tout seul. Une instance ponctuelle (spot) qui ne vit que le temps du calcul.

## Comment ça marche

```
ERP (capture ou import)  →  photogrammetry_jobs  statut='pret'
                                     ↓
                        worker : photogrammetry_reclamer()
                                     ↓
              télécharge les photos du bucket privé `captures`
                                     ↓
                    Meshroom (SfM + MVS) → OBJ texturé
                                     ↓
                         obj2gltf → GLB   [→ USDZ]
                                     ↓
            dépose dans `modeles`, appelle photogrammetry_terminer()
                                     ↓
              objects.model3d / model3d_ios renseignés → visible en AR
```

La réservation utilise `FOR UPDATE SKIP LOCKED` : deux workers lancés en
parallèle prennent des campagnes différentes, jamais la même. Un travail
abandonné (instance spot reprise par AWS) retourne en file au bout de 3 h.

## Mise en route

### 1. Renseigner les secrets

Dans `infra/terraform.tfvars` — **fichier non versionné** :

```hcl
gpu_worker_enabled   = true
supabase_url         = "https://dvwwwlqrwwzfwxukyoxz.supabase.co"
supabase_service_key = "eyJ..."   # clé de SERVICE, jamais la clé publique
```

La clé de service contourne toute la RLS. Elle ne doit jamais toucher le
frontend, ni un dépôt Git. Vous pouvez aussi la passer par l'environnement :

```bash
export TF_VAR_supabase_service_key="eyJ..."
```

### 2. Démarrer

```bash
terraform apply -target=aws_instance.gpu_worker
```

L'amorçage prend environ 10 minutes : mise à jour du système, `obj2gltf`, puis
le tirage de l'image Meshroom (~8 Go). Le worker démarre ensuite tout seul.

### 3. Suivre

```bash
aws ssm start-session --target $(terraform output -raw gpu_worker_id) --region eu-west-3
```

Puis sur la machine :

```bash
journalctl -u musea-worker -f
```

### 4. Arrêter

Le worker s'éteint seul après 20 minutes sans campagne, et l'instance est
**détruite** (`instance_initiated_shutdown_behavior = "terminate"`) — sans quoi
le volume EBS resterait facturé pour un travail terminé.

Pour empêcher qu'un `apply` ultérieur ne la relance, repasser
`gpu_worker_enabled = false`.

## Ce que ça coûte

| Poste | Ordre de grandeur |
|---|---|
| g4dn.xlarge en spot, eu-west-3 | ~0,20 $/h |
| Une campagne de 50 photos | 30 à 60 min de GPU |
| **Par objet numérisé** | **~0,10 à 0,20 $** |
| Amorçage (première fois seulement) | ~10 min, soit ~0,04 $ |

L'instance ne tourne que lorsqu'il y a du travail. Le poste dominant reste
l'amorçage : **grouper les campagnes** est nettement plus économique que de
lancer le worker pour un seul objet.

## Limites connues

**Le GLB est fiable, le USDZ ne l'est pas.** L'outillage USD sous Linux dépend
de la version installée. Le worker tente la conversion et **n'échoue pas** si
elle rate : le GLB seul reste exploitable partout, sauf en Quick Look iOS. Si le
USDZ compte pour vous, produisez-le à la main depuis le GLB (Blender, ou
`usdzconvert` d'Apple sur un Mac).

**Une reconstruction peut échouer légitimement.** Recouvrement insuffisant entre
photos voisines, objet trop uniforme pour offrir des points saillants, fond
mouvant. La cause remonte dans `photogrammetry_jobs.erreur` et s'affiche dans
l'ERP : c'est au conservateur de refaire la campagne autrement, pas au worker de
masquer le problème.

**Le disque.** 120 Go de racine : l'image Meshroom (~8 Go) plus les fichiers
intermédiaires d'une campagne dense (plusieurs Go). Le worker nettoie après
chaque travail, réussi ou non.

**Les photos ne sont pas purgées automatiquement.** ~150 Mo par objet dans le
bucket `captures`, contre 1 Go sur l'offre gratuite Supabase — soit environ six
objets. Après reconstruction, supprimer la campagne depuis l'ERP libère ses
photos.

## Dépannage

| Symptôme | Piste |
|---|---|
| Le worker ne démarre pas | `cat /var/log/musea-bootstrap.log` |
| « aucun GPU NVIDIA visible » | Type d'instance sans GPU, ou mauvaise AMI |
| Toutes les campagnes échouent | Vérifier `nvidia-smi` et `docker run --gpus all` |
| Campagne bloquée « en cours » | Instance reprise par AWS ; retour en file après 3 h |
| Rien n'est réclamé | Le statut doit être `pret`, pas `capture` |
