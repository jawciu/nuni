"""Export the figure as GLB: her body, eyes, brows, lashes and hair, textures included.

The body mesh alone renders as a clay mannequin with hollow sockets, because eyes and hair
are separate assets in MakeHuman. This builds the same figure make_figure.py renders and
exports it for the browser instead.

Arms are dropped 12 degrees, not 28: the garments were draped against the 12 degree body and
sliding a differently posed body under a finished drape makes the cloth poke through.

    Blender --background --python scripts/figure_to_glb.py
"""
import addon_utils, bpy, math, os, traceback

addon_utils.enable("bl_ext.blender_org.mpfb", default_set=True, persistent=True)
from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

D = os.path.expanduser(
    "~/Library/Application Support/Blender/5.2/extensions/.user/blender_org/mpfb/data"
)
OUT = os.path.expanduser("~/Code/nuni/public/assets/figure.glb")

SKIN = os.environ.get("SKIN", "toigo_light_skin_with_natural_makeup")
HAIR = os.environ.get("HAIR", "littleright_bobcut_hair")
HAIR_COLOUR = os.environ.get("HAIR_COLOUR", "#3a2418")
HAIR_GAIN = float(os.environ.get("HAIR_GAIN", "1.2"))
ARM_DROP = float(os.environ.get("ARM_DROP", "12"))


def env(name, default):
    return float(os.environ.get(name, default))


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

macro = TargetService.get_default_macro_info_dict()
macro.update({
    "gender": 0.0,
    "age": env("AGE", 0.35),
    "muscle": env("MUSCLE", 0.42),
    "weight": env("WEIGHT", 0.24),
    "height": env("HEIGHT", 0.78),
    "proportions": env("PROPORTIONS", 1.0),
    "cupsize": env("CUPSIZE", 0.35),
    "firmness": env("FIRMNESS", 0.6),
})
macro["race"] = {"african": 0.2, "asian": 0.2, "caucasian": 0.6}
basemesh = HumanService.create_human(macro_detail_dict=macro, scale=0.1)
print("body:", len(basemesh.data.vertices), "verts")


def add(kind, name, atype):
    p = f"{D}/{kind}/{name}/{name}.mhclo"
    if not os.path.exists(p):
        print("MISSING", p)
        return None
    try:
        a = HumanService.add_mhclo_asset(p, basemesh, asset_type=atype, subdiv_levels=0)
        print("added", atype, name)
        return a
    except Exception:
        traceback.print_exc()
        return None


try:
    # PRINCIPLED rather than ENHANCED_SSS: subsurface does not survive a glTF export, and a
    # node graph glTF cannot bake just comes out white
    HumanService.set_character_skin(
        f"{D}/skins/{SKIN}/{SKIN}.mhmat", basemesh, skin_type="PRINCIPLED"
    )
    print("skin:", SKIN)
except Exception:
    traceback.print_exc()

add("eyes", "high-poly", "Eyes")
add("eyebrows", "eyebrow010", "Eyebrows")
add("eyelashes", "eyelashes01", "Eyelashes")
hair_obj = add("hair", HAIR, "Hair")


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


if hair_obj is not None:
    # the hair maps are warm brown rather than neutral, so a straight multiply amplifies
    # their hue instead of replacing it. Desaturate first, then tint.
    tint = hexrgb(HAIR_COLOUR)
    for mat in hair_obj.data.materials:
        if not mat or not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if not bsdf:
            continue
        base = bsdf.inputs["Base Color"]
        src = base.links[0].from_socket if base.links else None
        if src:
            grey = nt.nodes.new("ShaderNodeHueSaturation")
            grey.inputs["Saturation"].default_value = 0.0
            grey.inputs["Value"].default_value = HAIR_GAIN
            mix = nt.nodes.new("ShaderNodeMixRGB")
            mix.blend_type = "MULTIPLY"
            mix.inputs["Fac"].default_value = 1.0
            mix.inputs["Color2"].default_value = (*tint, 1.0)
            nt.links.new(src, grey.inputs["Color"])
            nt.links.new(grey.outputs["Color"], mix.inputs["Color1"])
            nt.links.new(mix.outputs["Color"], base)
        # a broad soft highlight, not a wet one. Sheen and a hot specular blow every
        # outward facing strand to white and the colour disappears.
        for name, val in (("Sheen Weight", 0.04), ("Specular IOR Level", 0.22),
                          ("Roughness", 0.45)):
            if name in bsdf.inputs:
                bsdf.inputs[name].default_value = val
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = 0.0
        mat.blend_method = "BLEND" if hasattr(mat, "blend_method") else mat.blend_method
    print("hair tinted:", HAIR_COLOUR)

if ARM_DROP:
    import mathutils
    arm_obj = HumanService.add_builtin_rig(basemesh, "default")
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    for side, sign in (("L", 1.0), ("R", -1.0)):
        pb = arm_obj.pose.bones.get(f"upperarm01.{side}")
        if pb is None:
            continue
        # rotate about an axis through the bone's own head, or the arm swings off the
        # armature origin and leaves the body
        head = pb.matrix.to_translation()
        R = mathutils.Matrix.Rotation(math.radians(ARM_DROP * sign), 4, "Y")
        pb.matrix = (mathutils.Matrix.Translation(head) @ R @
                     mathutils.Matrix.Translation(-head) @ pb.matrix)
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode="OBJECT")
    print(f"arms dropped {ARM_DROP} deg")

bpy.context.view_layer.update()

keep = [o for o in bpy.context.scene.objects if o.type == "MESH"]
bpy.ops.object.select_all(action="DESELECT")
for o in keep:
    o.select_set(True)
bpy.context.view_layer.objects.active = keep[0]
print("exporting:", [o.name for o in keep])

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_apply=True,          # bake the modifiers, incl. the helper-geometry mask
    export_normals=True,
    export_materials="EXPORT",
    export_image_format="JPEG", # a 2048 skin as PNG is 4MB, as JPEG it is a few hundred KB
    export_jpeg_quality=88,
    export_draco_mesh_compression_enable=False,
    export_skins=False,
    export_animations=False,
)
print("wrote", OUT, os.path.getsize(OUT) // 1024, "KB")
